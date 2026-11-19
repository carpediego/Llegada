package com.carpediego.llegada

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (!NativeStore.isTracking(context)) return
        if (!PermissionHelper.hasFineLocation(context) && !PermissionHelper.hasCoarseLocation(context)) return
        try {
            GeofenceService.start(context)
        } catch (_: Exception) {
        }
    }
}
