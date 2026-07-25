package com.drive

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * DriveForegroundService
 *
 * Keeps the app alive during active P2P chunk transfers (upload or download).
 * Without this, Android's Doze Mode can kill background network sockets mid-transfer,
 * corrupting the chunk stream.
 *
 * The service runs ONLY during active transfers (started by DriveModule, stopped when done).
 * It is NOT always-on to preserve battery — this is the minimal correct approach.
 */
class DriveForegroundService : Service() {

    companion object {
        const val CHANNEL_ID = "drive_transfer_channel"
        const val NOTIF_ID = 1001
        const val EXTRA_TITLE = "title"

        fun start(ctx: Context, title: String) {
            val intent = Intent(ctx, DriveForegroundService::class.java).apply {
                putExtra(EXTRA_TITLE, title)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(intent)
            } else {
                ctx.startService(intent)
            }
        }

        fun stop(ctx: Context) {
            ctx.stopService(Intent(ctx, DriveForegroundService::class.java))
        }
    }

    override fun onCreate() {
        super.onCreate()
        createChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val title = intent?.getStringExtra(EXTRA_TITLE) ?: "Transferring…"
        val notif = buildNotification(title)
        startForeground(NOTIF_ID, notif)
        return START_NOT_STICKY // Do NOT restart if killed — transfers are user-initiated
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Drive File Transfers",
                NotificationManager.IMPORTANCE_LOW // silent — no sound or vibration
            ).apply {
                description = "Shown during active P2P encrypted file transfers"
                setShowBadge(false)
            }
            getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(title: String): Notification =
        NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText("Encrypted P2P transfer in progress")
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
}
