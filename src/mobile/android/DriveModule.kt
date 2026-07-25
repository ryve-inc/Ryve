package com.drive

import android.content.Context
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * DriveModule
 *
 * Exposed to React Native as NativeModules.DriveModule.
 * Provides startForeground / stopForeground so JS can control
 * the foreground service during active transfers.
 */
class DriveModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "DriveModule"

    @ReactMethod
    fun startForeground(title: String) {
        val ctx: Context = reactApplicationContext
        DriveForegroundService.start(ctx, title)
    }

    @ReactMethod
    fun stopForeground() {
        val ctx: Context = reactApplicationContext
        DriveForegroundService.stop(ctx)
    }
}
