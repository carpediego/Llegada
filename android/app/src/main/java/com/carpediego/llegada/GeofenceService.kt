package com.carpediego.llegada

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.VibrationEffect
import android.os.Vibrator
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class GeofenceService : Service(), LocationListener {
    companion object {
        const val ACTION_START = "com.carpediego.llegada.START"
        const val ACTION_STOP = "com.carpediego.llegada.STOP"
        const val ACTION_SYNC = "com.carpediego.llegada.SYNC"
        const val ACTION_RESOLVE = "com.carpediego.llegada.RESOLVE"

        const val ACTION_POSITION = "com.carpediego.llegada.POSITION"
        const val ACTION_PHASE = "com.carpediego.llegada.PHASE"
        const val ACTION_ALARM = "com.carpediego.llegada.ALARM"
        const val ACTION_STATUS = "com.carpediego.llegada.STATUS"

        const val EXTRA_JSON = "json"
        const val EXTRA_ID = "id"
        const val EXTRA_ACTION = "action"
        const val EXTRA_MINUTES = "minutes"

        private const val CHANNEL_SERVICE = "llegada_service_v1"
        private const val CHANNEL_ALARM = "llegada_alarm_v2"
        private const val FOREGROUND_ID = 1001
        private const val ALARM_NOTIFICATION_ID = 2001
        private const val PREFS = "llegada_native"

        fun start(context: Context) {
            NativeStore.setTracking(context, true)
            val intent = Intent(context, GeofenceService::class.java).setAction(ACTION_START)
            ContextCompat.startForegroundService(context, intent)
        }

        fun stop(context: Context) {
            NativeStore.setTracking(context, false)
            context.stopService(Intent(context, GeofenceService::class.java))
        }

        fun sync(context: Context, json: String) {
            NativeStore.sync(context, json)
            if (!NativeStore.isTracking(context)) return
            try {
                ContextCompat.startForegroundService(
                    context,
                    Intent(context, GeofenceService::class.java)
                        .setAction(ACTION_SYNC)
                        .putExtra(EXTRA_JSON, json)
                )
            } catch (_: Exception) {
            }
        }

        fun resolve(context: Context, id: String, action: String, minutes: Int) {
            context.startService(
                Intent(context, GeofenceService::class.java)
                    .setAction(ACTION_RESOLVE)
                    .putExtra(EXTRA_ID, id)
                    .putExtra(EXTRA_ACTION, action)
                    .putExtra(EXTRA_MINUTES, minutes)
            )
        }
    }

    private val handler = Handler(Looper.getMainLooper())
    private lateinit var locationManager: LocationManager
    private lateinit var notificationManager: NotificationManager
    private lateinit var vibrator: Vibrator
    private var powerManager: PowerManager? = null
    private var trackingWakeLock: PowerManager.WakeLock? = null
    private var alarmWakeLock: PowerManager.WakeLock? = null
    private var mediaPlayer: MediaPlayer? = null

    private var tracking = false
    private var configs: List<ReminderConfig> = emptyList()
    private var runtime: MutableMap<String, ReminderRuntime> = mutableMapOf()
    private var ringingId: String? = null
    private var foregroundStarted = false

    private val tickRunnable = Runnable { checkDue() }

    override fun onCreate() {
        super.onCreate()
        locationManager = getSystemService(Context.LOCATION_SERVICE) as LocationManager
        notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        vibrator = getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        powerManager = getSystemService(Context.POWER_SERVICE) as? PowerManager
        createChannels()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopTracking()
                return START_NOT_STICKY
            }
            ACTION_SYNC -> {
                if (!foregroundStarted && NativeStore.isTracking(this)) {
                    tracking = true
                    ensureForeground()
                    acquireTrackingWakeLock()
                    startLocationUpdates()
                }
                reload()
                updateForegroundNotification()
                scheduleNext()
                checkDue()
                return START_STICKY
            }
            ACTION_RESOLVE -> {
                val id = intent.getStringExtra(EXTRA_ID)
                val action = intent.getStringExtra(EXTRA_ACTION) ?: "done"
                val minutes = intent.getIntExtra(EXTRA_MINUTES, 10)
                if (id != null) resolveAlarm(id, action, minutes)
                return START_STICKY
            }
            else -> {
                beginTracking()
            }
        }
        return START_STICKY
    }

    private fun beginTracking() {
        if (!PermissionHelper.hasFineLocation(this) && !PermissionHelper.hasCoarseLocation(this)) {
            broadcastStatus("permission", "Falta el permiso de ubicación.")
            stopSelf()
            return
        }
        tracking = true
        NativeStore.setTracking(this, true)
        ensureForeground()
        acquireTrackingWakeLock()
        reload()
        startLocationUpdates()
        recoverRinging()
        broadcastStatus("active", "Vigilancia activa.")
        scheduleNext()
        checkDue()
    }

    private fun stopTracking() {
        tracking = false
        NativeStore.setTracking(this, false)
        try {
            locationManager.removeUpdates(this)
        } catch (_: Exception) {
        }
        stopAlarmSound()
        releaseTrackingWakeLock()
        handler.removeCallbacks(tickRunnable)
        broadcastStatus("off", "Vigilancia pausada.")
        if (foregroundStarted) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_REMOVE)
            } else {
                @Suppress("DEPRECATION")
                stopForeground(true)
            }
            foregroundStarted = false
        }
        stopSelf()
    }

    private fun ensureForeground() {
        if (foregroundStarted) return
        val notification = buildForegroundNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                FOREGROUND_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
            )
        } else {
            startForeground(FOREGROUND_ID, notification)
        }
        foregroundStarted = true
    }

    private fun updateForegroundNotification() {
        if (!foregroundStarted) return
        try {
            notificationManager.notify(FOREGROUND_ID, buildForegroundNotification())
        } catch (_: Exception) {
        }
    }

    private fun buildForegroundNotification(): Notification {
        val openIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pending = PendingIntent.getActivity(
            this,
            100,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val active = configs.count { it.enabled }
        val text = if (active == 0) {
            "La vigilancia está activa. Crea un recordatorio."
        } else {
            "Vigilando $active ${if (active == 1) "lugar" else "lugares"}."
        }
        return NotificationCompat.Builder(this, CHANNEL_SERVICE)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(getString(R.string.service_title))
            .setContentText(text)
            .setContentIntent(pending)
            .setOngoing(true)
            .setSilent(true)
            .setShowWhen(false)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun startLocationUpdates() {
        val providers = buildList {
            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                add(LocationManager.GPS_PROVIDER)
            }
            if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                add(LocationManager.NETWORK_PROVIDER)
            }
        }
        if (providers.isEmpty()) {
            broadcastStatus("error", "El GPS está desactivado.")
            return
        }

        var last: Location? = null
        for (provider in providers) {
            try {
                val candidate = locationManager.getLastKnownLocation(provider)
                if (candidate != null && (last == null || candidate.time > last.time)) {
                    last = candidate
                }
                locationManager.requestLocationUpdates(
                    provider,
                    15_000L,
                    5f,
                    this,
                    Looper.getMainLooper()
                )
            } catch (_: SecurityException) {
                broadcastStatus("permission", "Falta el permiso de ubicación.")
            } catch (_: Exception) {
            }
        }
        if (last != null) processLocation(last)
    }

    private fun reload() {
        configs = NativeStore.loadConfigs(this)
        runtime = NativeStore.loadRuntime(this)
        val ids = configs.map { it.id }.toSet()
        runtime.keys.retainAll(ids)
        for (config in configs) {
            runtime.getOrPut(config.id) { ReminderRuntime() }
        }
        NativeStore.saveRuntime(this, runtime)
    }

    private fun recoverRinging() {
        for (config in configs) {
            val state = runtime[config.id] ?: continue
            if (state.phase == "ringing" && config.enabled) {
                ringingId = null
                triggerAlarm(config)
                return
            }
        }
    }

    private fun processLocation(location: Location) {
        if (!tracking) return
        val accuracy = if (location.hasAccuracy()) location.accuracy.toDouble() else 0.0
        broadcastPosition(location, accuracy)

        var changed = false
        for (config in configs) {
            val state = runtime.getOrPut(config.id) { ReminderRuntime() }
            val distance = distanceMeters(
                location.latitude,
                location.longitude,
                config.lat,
                config.lng
            )
            val enterLimit = enterRadius(config, accuracy)
            val exitLimit = exitRadius(config, accuracy)

            if (state.inside == null) {
                state.inside = distance <= enterLimit
                changed = true
                continue
            }

            if (state.inside == false && distance <= enterLimit) {
                state.inside = true
                changed = true
                onEnterArea(config, state)
            } else if (state.inside == true && distance > exitLimit) {
                state.inside = false
                changed = true
                onExitArea(config, state)
            }
        }
        if (changed) {
            NativeStore.saveRuntime(this, runtime)
            for (config in configs) {
                runtime[config.id]?.let { broadcastPhase(config, it) }
            }
        }
        broadcastStatus("active", "Vigilancia activa.")
        scheduleNext()
    }

    private fun onEnterArea(config: ReminderConfig, state: ReminderRuntime) {
        if (!config.enabled) return
        if (state.phase == "ringing" || state.phase == "snoozed") return
        if (config.trigger != "enter") return
        armReminder(config, state, "enter")
    }

    private fun onExitArea(config: ReminderConfig, state: ReminderRuntime) {
        if (
            config.trigger == "enter" &&
            state.phase == "waiting" &&
            state.pendingDirection == "enter" &&
            config.requireStay
        ) {
            state.phase = "idle"
            state.pendingUntil = 0L
            NativeStore.saveRuntime(this, runtime)
            broadcastPhase(config, state)
            return
        }
        if (!config.enabled) return
        if (state.phase == "ringing" || state.phase == "snoozed") return
        if (config.trigger != "exit") return
        armReminder(config, state, "exit")
    }

    private fun armReminder(config: ReminderConfig, state: ReminderRuntime, direction: String) {
        if (config.delayMin > 0) {
            state.phase = "waiting"
            state.pendingDirection = direction
            state.pendingUntil = System.currentTimeMillis() +
                TimeUnit.MINUTES.toMillis(config.delayMin.toLong())
            state.snoozedUntil = 0L
            NativeStore.saveRuntime(this, runtime)
            broadcastPhase(config, state)
            scheduleNext()
        } else {
            triggerAlarm(config)
        }
    }

    private fun checkDue() {
        if (ringingId != null) return
        val now = System.currentTimeMillis()
        for (config in configs) {
            if (!config.enabled) continue
            val state = runtime[config.id] ?: continue
            if (state.phase == "waiting" && state.pendingUntil > 0 && state.pendingUntil <= now + 750) {
                triggerAlarm(config)
                return
            }
            if (state.phase == "snoozed" && state.snoozedUntil > 0 && state.snoozedUntil <= now + 750) {
                triggerAlarm(config)
                return
            }
        }
        scheduleNext()
    }

    private fun scheduleNext() {
        handler.removeCallbacks(tickRunnable)
        if (ringingId != null) return
        val now = System.currentTimeMillis()
        var nearest = Long.MAX_VALUE
        for (config in configs) {
            if (!config.enabled) continue
            val state = runtime[config.id] ?: continue
            if (state.phase == "waiting" && state.pendingUntil > now) {
                nearest = minOf(nearest, state.pendingUntil)
            }
            if (state.phase == "snoozed" && state.snoozedUntil > now) {
                nearest = minOf(nearest, state.snoozedUntil)
            }
        }
        if (nearest == Long.MAX_VALUE) return
        handler.postDelayed(tickRunnable, (nearest - now).coerceAtLeast(500L))
    }

    private fun triggerAlarm(config: ReminderConfig) {
        if (ringingId != null) return
        val state = runtime.getOrPut(config.id) { ReminderRuntime() }
        ringingId = config.id
        state.phase = "ringing"
        state.pendingUntil = 0L
        state.snoozedUntil = 0L
        NativeStore.saveRuntime(this, runtime)
        showAlarmNotification(config)
        startAlarmSound(config)
        broadcastAlarm(config)
        broadcastPhase(config, state)
        handler.removeCallbacks(tickRunnable)
    }

    private fun resolveAlarm(id: String, action: String, minutes: Int) {
        stopAlarmSound()
        try {
            notificationManager.cancel(ALARM_NOTIFICATION_ID)
        } catch (_: Exception) {
        }
        ringingId = null

        val config = configs.firstOrNull { it.id == id } ?: return
        val state = runtime.getOrPut(id) { ReminderRuntime() }
        val now = System.currentTimeMillis()
        if (action == "snooze") {
            state.phase = "snoozed"
            state.snoozedUntil = now + TimeUnit.MINUTES.toMillis(minutes.coerceAtLeast(1).toLong())
            state.pendingUntil = 0L
        } else {
            state.phase = if (config.repeat) "idle" else "done"
            state.pendingUntil = 0L
            state.snoozedUntil = 0L
            if (!config.repeat) {
                NativeStore.setEnabled(this, id, false)
                configs = configs.map { if (it.id == id) it.copy(enabled = false) else it }
            }
        }
        NativeStore.saveRuntime(this, runtime)
        broadcastPhase(config, state)
        scheduleNext()
        checkDue()
    }

    private fun showAlarmNotification(config: ReminderConfig) {
        val openIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or
                Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(MainActivity.EXTRA_ALARM_ID, config.id)
        }
        val pending = PendingIntent.getActivity(
            this,
            config.id.hashCode(),
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val notification = NotificationCompat.Builder(this, CHANNEL_ALARM)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(config.title)
            .setContentText("${config.placeName} · ${config.radius.toInt()} m")
            .setContentIntent(pending)
            .setFullScreenIntent(pending, true)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setOnlyAlertOnce(true)
            .setSound(null)
            .build()
        try {
            notificationManager.notify(ALARM_NOTIFICATION_ID, notification)
        } catch (_: SecurityException) {
        }
    }

    private fun startAlarmSound(config: ReminderConfig) {
        stopAlarmSound()
        if (config.sound) {
            try {
                val uri = android.media.RingtoneManager.getDefaultUri(
                    android.media.RingtoneManager.TYPE_ALARM
                ) ?: android.media.RingtoneManager.getDefaultUri(
                    android.media.RingtoneManager.TYPE_NOTIFICATION
                )
                val attributes = AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
                mediaPlayer = MediaPlayer().apply {
                    setAudioAttributes(attributes)
                    setDataSource(this@GeofenceService, uri)
                    isLooping = true
                    prepare()
                    start()
                }
            } catch (_: Exception) {
                mediaPlayer = null
            }
        }
        if (config.vibrate) {
            try {
                val pattern = longArrayOf(0, 400, 250, 400, 250, 700)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(
                        VibrationEffect.createWaveform(pattern, 0)
                    )
                } else {
                    @Suppress("DEPRECATION")
                    vibrator.vibrate(pattern, 0)
                }
            } catch (_: Exception) {
            }
        }
        alarmWakeLock = powerManager?.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "Llegada::Alarma"
        )?.apply {
            setReferenceCounted(false)
            acquire(10 * 60 * 1000L)
        }
    }

    private fun stopAlarmSound() {
        try {
            mediaPlayer?.stop()
        } catch (_: Exception) {
        }
        try {
            mediaPlayer?.release()
        } catch (_: Exception) {
        }
        mediaPlayer = null
        try {
            vibrator.cancel()
        } catch (_: Exception) {
        }
        alarmWakeLock?.let {
            if (it.isHeld) it.release()
        }
        alarmWakeLock = null
    }

    private fun acquireTrackingWakeLock() {
        if (trackingWakeLock?.isHeld == true) return
        trackingWakeLock = powerManager?.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "Llegada::Vigilancia"
        )?.apply {
            setReferenceCounted(false)
            acquire()
        }
    }

    private fun releaseTrackingWakeLock() {
        trackingWakeLock?.let {
            if (it.isHeld) it.release()
        }
        trackingWakeLock = null
    }

    private fun createChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val serviceChannel = NotificationChannel(
                CHANNEL_SERVICE,
                getString(R.string.service_channel_name),
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = getString(R.string.service_channel_description)
                setShowBadge(false)
            }
            val alarmChannel = NotificationChannel(
                CHANNEL_ALARM,
                getString(R.string.alarm_channel_name),
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = getString(R.string.alarm_channel_description)
                enableVibration(false)
                setSound(null, null)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            }
            notificationManager.createNotificationChannel(serviceChannel)
            notificationManager.createNotificationChannel(alarmChannel)
        }
    }

    private fun broadcastPosition(location: Location, accuracy: Double) {
        val json = JSONObject().apply {
            put("lat", location.latitude)
            put("lng", location.longitude)
            put("accuracy", accuracy)
            put("timestamp", location.time.takeIf { it > 0 } ?: System.currentTimeMillis())
        }
        broadcast(ACTION_POSITION, json.toString())
    }

    private fun broadcastPhase(config: ReminderConfig, state: ReminderRuntime) {
        val json = JSONObject().apply {
            put("id", config.id)
            put("phase", state.phase)
            put("pendingUntil", state.pendingUntil)
            put("pendingDirection", state.pendingDirection)
            put("snoozedUntil", state.snoozedUntil)
            put("enabled", config.enabled)
            if (state.inside != null) put("inside", state.inside) else put("inside", JSONObject.NULL)
        }
        broadcast(ACTION_PHASE, json.toString())
    }

    private fun broadcastAlarm(config: ReminderConfig) {
        val json = JSONObject().apply {
            put("id", config.id)
            put("title", config.title)
            put("placeName", config.placeName)
        }
        broadcast(ACTION_ALARM, json.toString())
    }

    private fun broadcastStatus(state: String, message: String) {
        val json = JSONObject().apply {
            put("state", state)
            put("message", message)
            put("tracking", tracking)
        }
        broadcast(ACTION_STATUS, json.toString())
    }

    private fun broadcast(action: String, json: String) {
        sendBroadcast(
            Intent(action)
                .setPackage(packageName)
                .putExtra(EXTRA_JSON, json)
        )
    }

    override fun onLocationChanged(location: Location) {
        processLocation(location)
    }

    @Deprecated("Deprecated in Java")
    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}

    override fun onProviderEnabled(provider: String) {}

    override fun onProviderDisabled(provider: String) {
        if (provider == LocationManager.GPS_PROVIDER) {
            broadcastStatus("weak", "GPS desactivado; usando red móvil.")
        }
    }

    override fun onDestroy() {
        handler.removeCallbacks(tickRunnable)
        try {
            locationManager.removeUpdates(this)
        } catch (_: Exception) {
        }
        stopAlarmSound()
        releaseTrackingWakeLock()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
