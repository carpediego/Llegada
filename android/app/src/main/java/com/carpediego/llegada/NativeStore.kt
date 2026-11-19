package com.carpediego.llegada

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

data class ReminderConfig(
    val id: String,
    val title: String,
    val placeName: String,
    val lat: Double,
    val lng: Double,
    val radius: Float,
    val trigger: String,
    val delayMin: Int,
    val requireStay: Boolean,
    val repeat: Boolean,
    val enabled: Boolean,
    val sound: Boolean,
    val vibrate: Boolean
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id)
        put("title", title)
        put("placeName", placeName)
        put("lat", lat)
        put("lng", lng)
        put("radius", radius.toDouble())
        put("trigger", trigger)
        put("delayMin", delayMin)
        put("requireStay", requireStay)
        put("repeat", repeat)
        put("enabled", enabled)
        put("sound", sound)
        put("vibrate", vibrate)
    }

    companion object {
        fun fromJson(json: JSONObject): ReminderConfig = ReminderConfig(
            id = json.optString("id", ""),
            title = json.optString("title", "Recordatorio"),
            placeName = json.optString("placeName", "Lugar"),
            lat = json.optDouble("lat", 0.0),
            lng = json.optDouble("lng", 0.0),
            radius = json.optDouble("radius", 150.0).toFloat(),
            trigger = if (json.optString("trigger") == "exit") "exit" else "enter",
            delayMin = json.optInt("delayMin", 0).coerceIn(0, 180),
            requireStay = json.optBoolean("requireStay", true),
            repeat = json.optBoolean("repeat", false),
            enabled = json.optBoolean("enabled", true),
            sound = json.optBoolean("sound", true),
            vibrate = json.optBoolean("vibrate", true)
        )
    }
}

data class ReminderRuntime(
    var inside: Boolean? = null,
    var phase: String = "idle",
    var pendingUntil: Long = 0L,
    var pendingDirection: String = "enter",
    var snoozedUntil: Long = 0L
) {
    fun toJson(): JSONObject = JSONObject().apply {
        if (inside != null) put("inside", inside) else put("inside", JSONObject.NULL)
        put("phase", phase)
        put("pendingUntil", pendingUntil)
        put("pendingDirection", pendingDirection)
        put("snoozedUntil", snoozedUntil)
    }

    companion object {
        fun fromJson(json: JSONObject): ReminderRuntime = ReminderRuntime(
            inside = if (json.isNull("inside")) null else json.optBoolean("inside"),
            phase = json.optString("phase", "idle"),
            pendingUntil = json.optLong("pendingUntil", 0L),
            pendingDirection = json.optString("pendingDirection", "enter"),
            snoozedUntil = json.optLong("snoozedUntil", 0L)
        )
    }
}

object NativeStore {
    private const val PREFS = "llegada_native"
    private const val KEY_CONFIGS = "configs"
    private const val KEY_RUNTIME = "runtime"
    private const val KEY_TRACKING = "tracking"

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    @Synchronized
    fun loadConfigs(context: Context): List<ReminderConfig> {
        val raw = prefs(context).getString(KEY_CONFIGS, null) ?: return emptyList()
        return try {
            val array = JSONArray(raw)
            buildList {
                for (index in 0 until array.length()) {
                    val config = ReminderConfig.fromJson(array.getJSONObject(index))
                    if (config.id.isNotBlank()) add(config)
                }
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    @Synchronized
    fun saveConfigs(context: Context, configs: List<ReminderConfig>) {
        val array = JSONArray()
        configs.forEach { array.put(it.toJson()) }
        prefs(context).edit().putString(KEY_CONFIGS, array.toString()).commit()
    }

    @Synchronized
    fun loadRuntime(context: Context): MutableMap<String, ReminderRuntime> {
        val raw = prefs(context).getString(KEY_RUNTIME, null) ?: return mutableMapOf()
        return try {
            val json = JSONObject(raw)
            val result = mutableMapOf<String, ReminderRuntime>()
            for (key in json.keys()) {
                result[key] = ReminderRuntime.fromJson(json.getJSONObject(key))
            }
            result
        } catch (_: Exception) {
            mutableMapOf()
        }
    }

    @Synchronized
    fun saveRuntime(context: Context, runtime: Map<String, ReminderRuntime>) {
        val json = JSONObject()
        runtime.forEach { (id, value) -> json.put(id, value.toJson()) }
        prefs(context).edit().putString(KEY_RUNTIME, json.toString()).commit()
    }

    @Synchronized
    fun sync(context: Context, rawJson: String) {
        val incoming: List<ReminderConfig> = try {
            val array = JSONArray(rawJson)
            buildList<ReminderConfig> {
                for (index in 0 until array.length()) {
                    val config = ReminderConfig.fromJson(array.getJSONObject(index))
                    if (config.id.isNotBlank()) add(config)
                }
            }
        } catch (_: Exception) {
            return
        }

        val previous = loadConfigs(context).associateBy { it.id }
        val runtime = loadRuntime(context)
        val incomingIds = incoming.map { it.id }.toSet()

        for (config in incoming) {
            val before = previous[config.id]
            val changed =
                before == null ||
                    before.enabled != config.enabled ||
                    before.lat != config.lat ||
                    before.lng != config.lng ||
                    before.radius != config.radius ||
                    before.trigger != config.trigger ||
                    before.delayMin != config.delayMin

            val current = runtime[config.id] ?: ReminderRuntime()
            if (changed || !config.enabled) {
                current.inside = null
                current.phase = "idle"
                current.pendingUntil = 0L
                current.snoozedUntil = 0L
            }
            runtime[config.id] = current
        }

        runtime.keys.retainAll(incomingIds)
        saveConfigs(context, incoming)
        saveRuntime(context, runtime)
    }

    @Synchronized
    fun resetRuntime(context: Context, id: String) {
        val runtime = loadRuntime(context)
        runtime[id] = ReminderRuntime()
        saveRuntime(context, runtime)
    }

    @Synchronized
    fun setEnabled(context: Context, id: String, enabled: Boolean) {
        val configs = loadConfigs(context).map {
            if (it.id == id) it.copy(enabled = enabled) else it
        }
        saveConfigs(context, configs)
    }

    fun setTracking(context: Context, tracking: Boolean) {
        prefs(context).edit().putBoolean(KEY_TRACKING, tracking).commit()
    }

    fun isTracking(context: Context): Boolean =
        prefs(context).getBoolean(KEY_TRACKING, false)
}

fun distanceMeters(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
    val earthRadius = 6371008.8
    val dLat = Math.toRadians(lat2 - lat1)
    val dLng = Math.toRadians(lng2 - lng1)
    val a = sin(dLat / 2) * sin(dLat / 2) +
        cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) *
        sin(dLng / 2) * sin(dLng / 2)
    return 2 * earthRadius * atan2(sqrt(a), sqrt(1 - a))
}

fun enterRadius(config: ReminderConfig, accuracy: Double): Double =
    config.radius + min(20.0, accuracy * 0.2)

fun exitRadius(config: ReminderConfig, accuracy: Double): Double =
    config.radius + max(20.0, min(90.0, accuracy * 0.6))
