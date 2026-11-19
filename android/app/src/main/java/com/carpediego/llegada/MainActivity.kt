package com.carpediego.llegada

import android.Manifest
import android.annotation.SuppressLint
import android.app.DownloadManager
import android.app.KeyguardManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import org.json.JSONObject
import java.io.File

class MainActivity : AppCompatActivity() {
    companion object {
        const val EXTRA_ALARM_ID = "alarm_id"
        private const val ASSET_HOST = "appassets.androidplatform.net"
        private const val APK_MIME = "application/vnd.android.package-archive"
    }

    private lateinit var webView: WebView
    private lateinit var bridge: NativeBridge
    private var pageReady = false
    private var pendingAlarmId: String? = null
    private var pendingStart = false
    private var pendingDownloadId: Long = -1L
    private var pendingDownloadVersion: String? = null
    private val handler = Handler(Looper.getMainLooper())
    private val downloadPoll = object : Runnable {
        override fun run() {
            checkDownloadStatus()
            if (pendingDownloadId != -1L) {
                handler.postDelayed(this, 2000L)
            }
        }
    }

    private val assetLoader by lazy {
        WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
    }

    private val appPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
            dispatchPermission()
            if (pendingStart) {
                pendingStart = false
                if (PermissionHelper.hasFineLocation(this) || PermissionHelper.hasCoarseLocation(this)) {
                    startTrackingService()
                    if (!PermissionHelper.hasBackgroundLocation(this)) {
                        toast("Para la pantalla apagada, permite Ubicación todo el tiempo en Ajustes.")
                    }
                } else {
                    dispatchStatus("permission", "Sin permiso de ubicación.")
                }
            }
        }

    private val backgroundPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) {
            dispatchPermission()
            if (!PermissionHelper.hasBackgroundLocation(this)) {
                toast("Si no cambió, abre Ajustes → Permisos → Ubicación → Permitir todo el tiempo.")
            }
        }

    private val serviceReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val action = intent?.action ?: return
            val json = intent.getStringExtra(GeofenceService.EXTRA_JSON) ?: return
            when (action) {
                GeofenceService.ACTION_POSITION -> dispatchJs("receivePosition", json)
                GeofenceService.ACTION_PHASE -> dispatchJs("receivePhase", json)
                GeofenceService.ACTION_STATUS -> dispatchJs("receiveStatus", json)
                GeofenceService.ACTION_ALARM -> {
                    val alarmId = try {
                        JSONObject(json).optString("id")
                    } catch (_: Exception) {
                        ""
                    }
                    if (alarmId.isNotBlank()) {
                        pendingAlarmId = alarmId
                        if (pageReady) dispatchAlarm(alarmId)
                    }
                }
            }
        }
    }

    private val downloadReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action != DownloadManager.ACTION_DOWNLOAD_COMPLETE) return
            val id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L)
            if (id != pendingDownloadId) return
            checkDownloadStatus()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        webView = WebView(this)
        bridge = NativeBridge(this, webView)
        setupWebView()

        val container = FrameLayout(this).apply {
            fitsSystemWindows = true
            addView(
                webView,
                FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT,
                    FrameLayout.LayoutParams.MATCH_PARENT
                )
            )
        }
        setContentView(container)

        registerReceivers()
        handleAlarmIntent(intent)
        webView.loadUrl("https://$ASSET_HOST/assets/www/index.html")
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = false
            allowContentAccess = true
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
            cacheMode = android.webkit.WebSettings.LOAD_DEFAULT
            userAgentString = "$userAgentString LlegadaAndroid/${BuildConfig.VERSION_NAME}"
            setSupportMultipleWindows(false)
        }
        webView.setBackgroundColor(0xFFF3EFE5.toInt())
        webView.fitsSystemWindows = true
        webView.addJavascriptInterface(bridge, "Android")

        webView.webViewClient = object : WebViewClientCompat() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): android.webkit.WebResourceResponse? {
                if (request.url.host == ASSET_HOST) {
                    return assetLoader.shouldInterceptRequest(request.url)
                }
                return super.shouldInterceptRequest(view, request)
            }

            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest
            ): Boolean {
                val uri = request.url
                if (uri.host == ASSET_HOST) return false
                openExternal(uri)
                return true
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                pageReady = true
                dispatchPermission()
                dispatchStatus(
                    if (NativeStore.isTracking(this@MainActivity)) "active" else "off",
                    ""
                )
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onCreateWindow(
                view: WebView?,
                isDialog: Boolean,
                isUserGesture: Boolean,
                resultMsg: android.os.Message?
            ): Boolean {
                return false
            }
        }
    }

    private fun registerReceivers() {
        val serviceFilter = IntentFilter().apply {
            addAction(GeofenceService.ACTION_POSITION)
            addAction(GeofenceService.ACTION_PHASE)
            addAction(GeofenceService.ACTION_STATUS)
            addAction(GeofenceService.ACTION_ALARM)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(serviceReceiver, serviceFilter, Context.RECEIVER_NOT_EXPORTED)
            registerReceiver(
                downloadReceiver,
                IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE),
                Context.RECEIVER_EXPORTED
            )
        } else {
            @Suppress("DEPRECATION")
            registerReceiver(serviceReceiver, serviceFilter)
            @Suppress("DEPRECATION")
            registerReceiver(downloadReceiver, IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE))
        }
    }

    private fun handleAlarmIntent(intent: Intent?) {
        val alarmId = intent?.getStringExtra(EXTRA_ALARM_ID) ?: return
        pendingAlarmId = alarmId
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                android.view.WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    android.view.WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            )
        }
        (getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager)
            ?.requestDismissKeyguard(this, null)
        if (pageReady) {
            webView.postDelayed({
                val id = pendingAlarmId
                if (id != null) {
                    pendingAlarmId = null
                    dispatchAlarm(id)
                }
            }, 900L)
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleAlarmIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        dispatchPermission()
        dispatchStatus(
            if (NativeStore.isTracking(this)) "active" else "off",
            ""
        )
        if (pageReady && pendingAlarmId != null) {
            val id = pendingAlarmId
            webView.postDelayed({
                if (pendingAlarmId == id) {
                    pendingAlarmId = null
                    if (id != null) dispatchAlarm(id)
                }
            }, 900L)
        }
    }

    private fun dispatchAlarm(id: String) {
        if (!pageReady) {
            pendingAlarmId = id
            return
        }
        pendingAlarmId = null
        dispatchJs("receiveAlarm", id)
    }

    private fun dispatchPermission() {
        val state = PermissionHelper.state(this)
        if (pageReady) {
            webView.evaluateJavascript(
                "window.LlegadaNative && window.LlegadaNative.receivePermission(${JSONObject.quote(state)})",
                null
            )
        }
    }

    private fun dispatchStatus(state: String, message: String) {
        if (!pageReady) return
        val json = JSONObject().apply {
            put("state", state)
            put("message", message)
            put("tracking", NativeStore.isTracking(this@MainActivity))
        }.toString()
        dispatchJs("receiveStatus", json)
    }

    private fun dispatchJs(function: String, argument: String) {
        if (!pageReady) return
        webView.post {
            webView.evaluateJavascript(
                "window.LlegadaNative && window.LlegadaNative.$function(${JSONObject.quote(argument)})",
                null
            )
        }
    }

    private fun startTrackingService() {
        try {
            GeofenceService.start(this)
        } catch (error: Exception) {
            toast("No se pudo iniciar la vigilancia: ${error.message}")
        }
    }

    private fun openExternal(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (_: Exception) {
            toast("No se pudo abrir el enlace.")
        }
    }

    internal fun requestAppPermissions() {
        val permissions = mutableListOf(
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissions.add(Manifest.permission.POST_NOTIFICATIONS)
        }
        appPermissionLauncher.launch(permissions.toTypedArray())
    }

    internal fun requestBackgroundPermission() {
        if (!PermissionHelper.hasFineLocation(this)) {
            pendingStart = true
            requestAppPermissions()
            return
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            dispatchPermission()
            return
        }
        backgroundPermissionLauncher.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
    }

    internal fun openAppSettings() {
        try {
            startActivity(
                Intent(
                    Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:$packageName")
                )
            )
        } catch (_: Exception) {
            toast("Abre los ajustes de Android para cambiar los permisos.")
        }
    }

    internal fun requestIgnoreBatteryOptimizations() {
        val power = getSystemService(Context.POWER_SERVICE) as android.os.PowerManager
        if (power.isIgnoringBatteryOptimizations(packageName)) {
            toast("La app ya está excluida del ahorro de batería.")
            return
        }
        try {
            startActivity(
                Intent(
                    Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    Uri.parse("package:$packageName")
                )
            )
        } catch (_: Exception) {
            try {
                startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
            } catch (_: Exception) {
                toast("Abre Ajustes → Batería → Sin restricciones para Llegada.")
            }
        }
    }

    internal fun nativeStatusJson(): String {
        val power = getSystemService(Context.POWER_SERVICE) as android.os.PowerManager
        return JSONObject().apply {
            put("fine", PermissionHelper.hasFineLocation(this@MainActivity))
            put("coarse", PermissionHelper.hasCoarseLocation(this@MainActivity))
            put("background", PermissionHelper.hasBackgroundLocation(this@MainActivity))
            put("notifications", PermissionHelper.hasNotifications(this@MainActivity))
            put("battery", power.isIgnoringBatteryOptimizations(this@MainActivity.packageName))
            put("tracking", NativeStore.isTracking(this@MainActivity))
            put("version", BuildConfig.VERSION_NAME)
        }.toString()
    }

    internal fun requestSingleLocation(requestId: String) {
        if (!PermissionHelper.hasFineLocation(this) && !PermissionHelper.hasCoarseLocation(this)) {
            dispatchLocationError(requestId, "Sin permiso de ubicación.")
            return
        }
        val manager = getSystemService(Context.LOCATION_SERVICE) as android.location.LocationManager
        val providers = listOf(
            android.location.LocationManager.GPS_PROVIDER,
            android.location.LocationManager.NETWORK_PROVIDER
        ).filter {
            try {
                manager.isProviderEnabled(it)
            } catch (_: Exception) {
                false
            }
        }
        if (providers.isEmpty()) {
            dispatchLocationError(requestId, "El GPS está desactivado.")
            return
        }

        var last: android.location.Location? = null
        for (provider in providers) {
            try {
                val candidate = manager.getLastKnownLocation(provider)
                if (candidate != null && (last == null || candidate.time > last.time)) last = candidate
                if (candidate != null && System.currentTimeMillis() - candidate.time < 45_000) {
                    dispatchLocation(requestId, candidate)
                    return
                }
            } catch (_: SecurityException) {
                dispatchLocationError(requestId, "Sin permiso de ubicación.")
                return
            } catch (_: Exception) {
            }
        }

        val handler = Handler(Looper.getMainLooper())
        var finished = false
        val listener = object : android.location.LocationListener {
            override fun onLocationChanged(location: android.location.Location) {
                if (finished) return
                finished = true
                manager.removeUpdates(this)
                handler.removeCallbacksAndMessages(null)
                dispatchLocation(requestId, location)
            }

            @Deprecated("Deprecated in Java")
            override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}

            override fun onProviderEnabled(provider: String) {}

            override fun onProviderDisabled(provider: String) {}
        }
        try {
            for (provider in providers) {
                manager.requestLocationUpdates(provider, 0L, 0f, listener, Looper.getMainLooper())
            }
        } catch (_: SecurityException) {
            dispatchLocationError(requestId, "Sin permiso de ubicación.")
            return
        }
        handler.postDelayed({
            if (!finished) {
                finished = true
                try {
                    manager.removeUpdates(listener)
                } catch (_: Exception) {
                }
                if (last != null) dispatchLocation(requestId, last!!)
                else dispatchLocationError(requestId, "No se pudo obtener tu ubicación.")
            }
        }, 20_000L)
    }

    private fun dispatchLocation(requestId: String, location: android.location.Location) {
        val json = JSONObject().apply {
            put("lat", location.latitude)
            put("lng", location.longitude)
            put("accuracy", if (location.hasAccuracy()) location.accuracy.toDouble() else 0.0)
            put("timestamp", location.time.takeIf { it > 0 } ?: System.currentTimeMillis())
        }.toString()
        webView.post {
            webView.evaluateJavascript(
                "window.LlegadaNative && window.LlegadaNative.receiveLocation(" +
                    "${JSONObject.quote(requestId)}, ${JSONObject.quote(json)})",
                null
            )
        }
    }

    private fun dispatchLocationError(requestId: String, message: String) {
        webView.post {
            webView.evaluateJavascript(
                "window.LlegadaNative && window.LlegadaNative.receiveLocationError(" +
                    "${JSONObject.quote(requestId)}, ${JSONObject.quote(message)})",
                null
            )
        }
    }

    internal fun downloadAndInstallApk(url: String, version: String) {
        try {
            val fileName = "llegada-$version.apk"
            val destination = File(
                getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS),
                fileName
            )
            if (destination.exists()) destination.delete()
            val request = DownloadManager.Request(Uri.parse(url))
                .setTitle("Llegada $version")
                .setDescription("Descargando actualización…")
                .setMimeType(APK_MIME)
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, fileName)
            val manager = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            pendingDownloadId = manager.enqueue(request)
            pendingDownloadVersion = version
            handler.removeCallbacks(downloadPoll)
            handler.postDelayed(downloadPoll, 1500L)
            toast("Descargando la actualización…")
        } catch (error: Exception) {
            toast("No se pudo descargar: ${error.message}")
        }
    }

    private fun checkDownloadStatus() {
        val id = pendingDownloadId
        if (id == -1L) return
        val manager = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        val cursor = manager.query(DownloadManager.Query().setFilterById(id))
        try {
            if (!cursor.moveToFirst()) return
            val status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
            when (status) {
                DownloadManager.STATUS_SUCCESSFUL -> {
                    pendingDownloadId = -1L
                    handler.removeCallbacks(downloadPoll)
                    installDownloadedApk()
                }
                DownloadManager.STATUS_FAILED -> {
                    pendingDownloadId = -1L
                    handler.removeCallbacks(downloadPoll)
                    toast("La descarga falló. Revisa tu conexión e inténtalo otra vez.")
                }
            }
        } finally {
            cursor.close()
        }
    }

    private fun installDownloadedApk() {
        val version = pendingDownloadVersion ?: return
        val file = File(
            getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS),
            "llegada-$version.apk"
        )
        if (!file.exists()) {
            toast("La descarga no terminó correctamente.")
            return
        }
        try {
            val uri = FileProvider.getUriForFile(
                this,
                "$packageName.fileprovider",
                file
            )
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, APK_MIME)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            startActivity(intent)
        } catch (_: Exception) {
            try {
                startActivity(
                    Intent(
                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:$packageName")
                    )
                )
                toast("Permite instalar apps desconocidas y vuelve a intentarlo.")
            } catch (_: Exception) {
                toast("No se pudo abrir el instalador del APK.")
            }
        }
    }

    internal fun toast(message: String) {
        runOnUiThread {
            Toast.makeText(this, message, Toast.LENGTH_LONG).show()
        }
    }

    override fun onDestroy() {
        handler.removeCallbacks(downloadPoll)
        try {
            unregisterReceiver(serviceReceiver)
        } catch (_: Exception) {
        }
        try {
            unregisterReceiver(downloadReceiver)
        } catch (_: Exception) {
        }
        webView.destroy()
        super.onDestroy()
    }

    @Suppress("unused")
    inner class NativeBridge(
        private val activity: MainActivity,
        @Suppress("unused") private val view: WebView
    ) {
        @JavascriptInterface
        fun isNative(): Boolean = true

        @JavascriptInterface
        fun getVersionName(): String = BuildConfig.VERSION_NAME

        @JavascriptInterface
        fun getPermissionState(): String = PermissionHelper.state(activity)

        @JavascriptInterface
        fun getNativeStatus(): String = activity.nativeStatusJson()

        @JavascriptInterface
        fun requestPermissions() {
            activity.runOnUiThread { activity.requestAppPermissions() }
        }

        @JavascriptInterface
        fun requestBackgroundLocation() {
            activity.runOnUiThread { activity.requestBackgroundPermission() }
        }

        @JavascriptInterface
        fun openAppSettings() {
            activity.runOnUiThread { activity.openAppSettings() }
        }

        @JavascriptInterface
        fun requestIgnoreBatteryOptimizations() {
            activity.runOnUiThread { activity.requestIgnoreBatteryOptimizations() }
        }

        @JavascriptInterface
        fun startTracking(): String {
            if (!PermissionHelper.hasFineLocation(activity) && !PermissionHelper.hasCoarseLocation(activity)) {
                activity.runOnUiThread {
                    activity.pendingStart = true
                    activity.requestAppPermissions()
                }
                return "permission_required"
            }
            activity.runOnUiThread { activity.startTrackingService() }
            return "started"
        }

        @JavascriptInterface
        fun stopTracking() {
            activity.runOnUiThread { GeofenceService.stop(activity) }
        }

        @JavascriptInterface
        fun syncReminders(json: String) {
            try {
                GeofenceService.sync(activity, json)
            } catch (_: Exception) {
            }
        }

        @JavascriptInterface
        fun resetReminder(id: String) {
            NativeStore.resetRuntime(activity, id)
        }

        @JavascriptInterface
        fun resolveAlarm(id: String, action: String, minutes: Int) {
            activity.runOnUiThread {
                GeofenceService.resolve(activity, id, action, minutes)
            }
        }

        @JavascriptInterface
        fun consumePendingAlarm(): String {
            val id = activity.pendingAlarmId ?: return ""
            activity.pendingAlarmId = null
            return id
        }

        @JavascriptInterface
        fun locateOnce(requestId: String) {
            activity.runOnUiThread { activity.requestSingleLocation(requestId) }
        }

        @JavascriptInterface
        fun downloadAndInstallApk(url: String, version: String) {
            activity.runOnUiThread { activity.downloadAndInstallApk(url, version) }
        }

        @JavascriptInterface
        fun openUrl(url: String) {
            activity.runOnUiThread {
                try {
                    activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                } catch (_: Exception) {
                }
            }
        }

        @JavascriptInterface
        fun showToast(message: String) {
            activity.toast(message)
        }
    }
}
