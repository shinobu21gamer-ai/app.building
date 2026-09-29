package com.barangayresolve.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.os.Build;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        createNotificationChannels();
    }

    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }

        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;

        // Default FCM channel with high importance for heads-up notifications
        NotificationChannel fcmChannel = new NotificationChannel(
                "fcm_default_channel",
                "FCM Notifications",
                NotificationManager.IMPORTANCE_HIGH
        );
        fcmChannel.setDescription("Default FCM push notifications");
        fcmChannel.enableLights(true);
        fcmChannel.enableVibration(true);
        fcmChannel.setSound(
                RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
                new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                        .build()
        );
        fcmChannel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
        manager.createNotificationChannel(fcmChannel);

        // Severity-specific channels
        createChannel(manager, "alerts_info", "Info Alerts", NotificationManager.IMPORTANCE_DEFAULT, false);
        createChannel(manager, "alerts_warning", "Warning Alerts", NotificationManager.IMPORTANCE_HIGH, true);
        createChannel(manager, "alerts_critical", "Critical Alerts", NotificationManager.IMPORTANCE_HIGH, true);
    }

    private void createChannel(NotificationManager manager, String id, String name, int importance, boolean highPriority) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;

        NotificationChannel channel = new NotificationChannel(id, name, importance);
        channel.setDescription(name + " notifications");
        channel.enableLights(true);
        channel.enableVibration(highPriority);
        channel.setSound(
                RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
                new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                        .build()
        );
        channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
        if (highPriority) {
            channel.setImportance(NotificationManager.IMPORTANCE_HIGH);
        }
        manager.createNotificationChannel(channel);
    }
}