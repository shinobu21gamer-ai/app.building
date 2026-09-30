package com.barangayresolve.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;

/** Central channel ownership so the app and the alert services agree. */
public final class NotificationChannels {

  public static final String FCM_DEFAULT_CHANNEL_ID = "fcm_default_channel";
  public static final String SERVICE_CHANNEL_ID = "alert_foreground_service";
  public static final String FALLBACK_CHANNEL_ID = "alerts_sound_fallback";

  public static final String CHANNEL_INFO = "alerts_info";
  public static final String CHANNEL_WARNING = "alerts_warning";
  public static final String CHANNEL_CRITICAL = "alerts_critical";

  private NotificationChannels() {}

  public static String severityChannelId(String severity) {
    if ("CRITICAL".equals(severity)) return CHANNEL_CRITICAL;
    if ("WARNING".equals(severity)) return CHANNEL_WARNING;
    return CHANNEL_INFO;
  }

  public static int severityColor(String severity) {
    if ("CRITICAL".equals(severity)) return 0xFFDC2626;
    if ("WARNING".equals(severity)) return 0xFFF59E0B;
    return 0xFF2563EB;
  }

  /** ms on / ms off / ... pattern used both by the notification channel and the alarm vibrator. */
  public static long[] vibrationPattern(String severity) {
    if ("CRITICAL".equals(severity)) {
      return new long[] {0, 1000, 500, 1000, 500, 1000, 500, 1000, 500, 1000};
    }
    if ("WARNING".equals(severity)) {
      return new long[] {0, 500, 200, 500, 200, 500, 200, 500};
    }
    return new long[] {0, 300, 100, 300};
  }

  public static int rawSound(String severity) {
    if ("CRITICAL".equals(severity)) return R.raw.alert_critical_long;
    if ("WARNING".equals(severity)) return R.raw.alert_warning_long;
    return R.raw.alert_info_long;
  }

  public static void ensure(Context context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
    NotificationManager manager = context.getSystemService(NotificationManager.class);
    if (manager == null) return;

    AudioAttributes notificationAttrs =
        new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();

    // Default channel for any straggler system-rendered FCM messages.
    NotificationChannel fcm =
        new NotificationChannel(FCM_DEFAULT_CHANNEL_ID, "FCM Notifications", NotificationManager.IMPORTANCE_HIGH);
    fcm.setDescription("Default FCM push notifications");
    fcm.enableLights(true);
    fcm.enableVibration(true);
    fcm.setSound(RingtoneDefaults.get(context), notificationAttrs);
    fcm.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
    manager.createNotificationChannel(fcm);

    // Quiet "monitoring" channel used by the foreground service.
    NotificationChannel service =
        new NotificationChannel(SERVICE_CHANNEL_ID, "Alert Monitoring", NotificationManager.IMPORTANCE_LOW);
    service.setDescription("Keeps the alert alarm active");
    service.setShowBadge(false);
    manager.createNotificationChannel(service);

    // Severity channels: silent (the foreground service owns the looping alarm sound)
    // but loud in every other respect so heads-up + vibration still fire.
    createSeverityChannel(manager, CHANNEL_INFO, "Info Alerts", NotificationManager.IMPORTANCE_HIGH);
    createSeverityChannel(manager, CHANNEL_WARNING, "Warning Alerts", NotificationManager.IMPORTANCE_HIGH);
    createSeverityChannel(manager, CHANNEL_CRITICAL, "Critical Alerts", NotificationManager.IMPORTANCE_HIGH);

    // Absolute last-resort channel that DOES play a sound, used only when the
    // foreground service cannot be started from the push handler.
    NotificationChannel fallback =
        new NotificationChannel(FALLBACK_CHANNEL_ID, "Alert Sound Fallback", NotificationManager.IMPORTANCE_HIGH);
    fallback.setDescription("Fallback alert chime");
    fallback.enableLights(true);
    fallback.enableVibration(true);
    fallback.setSound(
        Uri.parse("android.resource://" + context.getPackageName() + "/" + R.raw.alert_critical_long),
        notificationAttrs);
    fallback.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
    manager.createNotificationChannel(fallback);
  }

  private static void createSeverityChannel(NotificationManager manager, String id, String name, int importance) {
    NotificationChannel channel = new NotificationChannel(id, name, importance);
    channel.setDescription(name + " notifications");
    channel.enableLights(true);
    channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
    channel.setShowBadge(true);
    channel.setSound(null, null);
    channel.enableVibration(true);
    channel.setVibrationPattern(vibrationPattern(severityForChannel(id)));
    manager.createNotificationChannel(channel);
  }

  private static String severityForChannel(String channelId) {
    if (CHANNEL_CRITICAL.equals(channelId)) return "CRITICAL";
    if (CHANNEL_WARNING.equals(channelId)) return "WARNING";
    return "INFO";
  }

  /** Small helper kept separate so channel construction reads cleanly. */
  private static final class RingtoneDefaults {
    static Uri get(Context context) {
      return android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_NOTIFICATION);
    }
  }
}
