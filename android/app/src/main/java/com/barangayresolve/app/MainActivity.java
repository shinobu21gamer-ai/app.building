package com.barangayresolve.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.os.Build;
import android.os.Bundle;
import android.content.pm.PackageManager;
import android.content.Intent;
import android.provider.Settings;
import android.app.Activity;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;
import androidx.localbroadcastmanager.content.LocalBroadcastManager;

public class MainActivity extends BridgeActivity {
    private static final int OVERLAY_PERMISSION_REQUEST_CODE = 1234;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        createNotificationChannels();
        requestOverlayPermission();
        startForegroundService();

        // Add JavaScript interface for web-to-native communication
        WebView webView = getBridge().getWebView();
        if (webView != null) {
            webView.addJavascriptInterface(new AlertBridge(), "AlertBridge");
        }
    }

    public class AlertBridge {
        @JavascriptInterface
        public void stopAlertSound() {
            // Send broadcast to stop the foreground service alert sound
            Intent intent = new Intent(AlertForegroundService.ACTION_STOP_ALERT);
            LocalBroadcastManager.getInstance(MainActivity.this).sendBroadcast(intent);
        }
    }

    private void requestOverlayPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (!Settings.canDrawOverlays(this)) {
                Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                        android.net.Uri.parse("package:" + getPackageName()));
                startActivityForResult(intent, OVERLAY_PERMISSION_REQUEST_CODE);
            }
        }
    }

    private void startForegroundService() {
        Intent serviceIntent = new Intent(this, AlertForegroundService.class);
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            startForegroundService(new Intent(this, AlertForegroundService.class));
        } else {
            startService(new Intent(this, AlertForegroundService.class));
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == OVERLAY_PERMISSION_REQUEST_CODE) {
            // Permission result handled
        }
    }

    private void createNotificationChannels() {
        if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.O) {
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
                android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_NOTIFICATION),
                new android.media.AudioAttributes.Builder()
                        .setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION)
                        .build()
        );
        fcmChannel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
        manager.createNotificationChannel(fcmChannel);

        // Severity-specific channels
        createChannel(manager, "alerts_info", "Info Alerts", NotificationManager.IMPORTANCE_HIGH, true);
        createChannel(manager, "alerts_warning", "Warning Alerts", NotificationManager.IMPORTANCE_HIGH, true);
        createChannel(manager, "alerts_critical", "Critical Alerts", NotificationManager.IMPORTANCE_HIGH, true);
    }

    private void createChannel(NotificationManager manager, String id, String name, int importance, boolean highPriority) {
        if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.O) return;

        NotificationChannel channel = new NotificationChannel(id, name, importance);
        channel.setDescription(name + " notifications");
        channel.enableLights(true);
        channel.enableVibration(true);
        channel.setSound(
                android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_NOTIFICATION),
                new android.media.AudioAttributes.Builder()
                        .setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION)
                        .build()
        );
        channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
        channel.setImportance(NotificationManager.IMPORTANCE_HIGH);
        channel.enableVibration(true);
        manager.createNotificationChannel(channel);
    }
}