package com.barangayresolve.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

public class AlertForegroundService extends Service {

    private static final String CHANNEL_ID = "alert_foreground_service";
    private static final int NOTIFICATION_ID = 1001;
    private MediaPlayer mediaPlayer;
    private boolean isLooping = false;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String alertTitle = intent.getStringExtra("alert_title");
        String alertMessage = intent.getStringExtra("alert_message");
        String severity = intent.getStringExtra("severity");

        Notification notification = buildNotification(alertTitle, alertMessage, severity);
        startForeground(NOTIFICATION_ID, notification);

        // Play alert sound in loop
        playAlertSound();

        return START_STICKY;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Alert Foreground Service",
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Keeps alert monitoring active");
            NotificationManager manager = getSystemService(NotificationManager.class);
            manager.createNotificationChannel(channel);
        }
    }

    private Notification buildNotification(String title, String message, String severity) {
        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this, 0, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );

        int color = 0xFF2482CC; // brand blue
        if ("CRITICAL".equals(severity)) color = 0xFFDC2626;
        else if ("WARNING".equals(severity)) color = 0xFFF59E0B;

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle(title != null ? title : "BarangayResolve Alert")
                .setContentText(message != null ? message : "Monitoring for alerts...")
                .setSmallIcon(android.R.drawable.ic_dialog_alert)
                .setColor(color)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .build();
    }

    private void playAlertSound() {
        try {
            if (mediaPlayer != null) {
                mediaPlayer.release();
            }
            mediaPlayer = MediaPlayer.create(this, R.raw.alert_long);
            if (mediaPlayer != null) {
                mediaPlayer.setLooping(true);
                mediaPlayer.setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build());
                mediaPlayer.start();
                isLooping = true;
            }
        } catch (Exception e) {
            Log.e("AlertForegroundService", "Error playing alert sound", e);
        }
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (mediaPlayer != null) {
            mediaPlayer.stop();
            mediaPlayer.release();
            mediaPlayer = null;
            isLooping = false;
        }
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}