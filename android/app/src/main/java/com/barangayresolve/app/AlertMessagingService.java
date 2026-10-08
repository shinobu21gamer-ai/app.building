package com.barangayresolve.app;

import android.app.KeyguardManager;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.os.Build;
import android.os.PowerManager;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Locale;
import java.util.Map;

/**
 * Single entry point for FCM data-only alert messages. The app deliberately does NOT
 * ship an FCM "notification" payload: a data-only high-priority message can start this
 * process while the app is backgrounded, which lets the native layer
 * show the native alarm experience (severity sound, vibration, popup) instead of a plain
 * system notification (see push.ts).
 */
public class AlertMessagingService extends FirebaseMessagingService {

  private static final String TAG = "AlertMessaging";
  private static final String NOTIFICATION_TAG = "barangayalert";

  @Override
  public void onMessageReceived(@NonNull RemoteMessage message) {
    NotificationChannels.ensure(this);

    Map<String, String> data = message.getData();
    String alertId = data.get("alertId");
    String title = firstNonEmpty(data.get("title"), message.getNotification() == null ? null : message.getNotification().getTitle(), "BarangayResolve Alert");
    String body = firstNonEmpty(data.get("body"), data.get("message"), message.getNotification() == null ? null : message.getNotification().getBody(), "");
    String severity = firstNonEmpty(data.get("severity"), "INFO").toUpperCase(Locale.US);
    String url = firstNonEmpty(data.get("url"), "/alerts");
    String createdAt = firstNonEmpty(data.get("createdAt"), currentTimestamp());
    String expiresAt = data.get("expiresAt");
    boolean sound = !"false".equalsIgnoreCase(data.get("sound"));

    if (alertId == null) {
      // Not one of ours; let the OS show it as a plain notification.
      postSystemNotification(title, body);
      return;
    }

    int id = parseId(alertId);

    // Nobody is signed in on this device. The server drops this device from the
    // broadcast as soon as it signs out, but a message already in flight (or one
    // queued by FCM while offline) still lands here — an unattended phone must
    // not raise an alarm the user cannot acknowledge.
    if (!SessionState.deliveryAllowed(this)) {
      Log.i(TAG, "Dropping alert " + id + ": no signed-in session on this device.");
      return;
    }

    boolean handleInWeb = MainActivity.canHandleAlertInWeb(this);
    if (!handleInWeb) {
      boolean alarmAlreadyActive =
          AlertForegroundService.hasActiveAlert() || AlertRestartReceiver.hasActiveAlert(this);
      boolean fullScreen = !alarmAlreadyActive && shouldUseFullScreenIntent();
      boolean showOverlay = !alarmAlreadyActive && !fullScreen && isInteractiveAndUnlocked();
      postAlertNotification(
          id,
          title,
          body,
          severity,
          url,
          NotificationChannels.severityChannelId(severity),
          fullScreen,
          !alarmAlreadyActive);
      startAlarm(title, body, severity, id, sound, showOverlay);
    } else {
      MainActivity.dispatchToNativePush(
          toAlertJson(id, title, body, severity, url, sound, createdAt, expiresAt));
    }
  }

  @Override
  public void onNewToken(@NonNull String token) {
    super.onNewToken(token);
    // The web layer re-registers this token on its next mount; if the app is open we
    // let it know right now so the server is never left pointing at a stale token.
    String js =
        "try{window.dispatchEvent(new CustomEvent('native-token-refreshed',{detail:{token:"
            + jsonEscape(token)
            + "}}))}catch(e){}";
    MainActivity.dispatchToWeb(js);
  }

  private void postSystemNotification(String title, String body) {
    Intent open = new Intent(this, MainActivity.class);
    open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    PendingIntent content = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

    NotificationCompat.Builder builder =
        new NotificationCompat.Builder(this, NotificationChannels.FCM_DEFAULT_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setColor(NotificationChannels.severityColor("INFO"))
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_RECOMMENDATION)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setContentIntent(content);

    try {
      NotificationManagerCompat.from(this).notify(0, builder.build());
    } catch (SecurityException ignored) {
      // POST_NOTIFICATIONS not granted; nothing we can do from here.
    }
  }

  private void postAlertNotification(
      int id,
      String title,
      String body,
      String severity,
      String url,
      String channelId,
      boolean useFullScreenIntent,
      boolean silent) {
    PendingIntent fullScreen = null;
    if (useFullScreenIntent) {
      Intent fs = new Intent(this, FullScreenAlertActivity.class);
      fs.putExtra(FullScreenAlertActivity.EXTRA_ALERT_ID, id);
      fs.putExtra(FullScreenAlertActivity.EXTRA_TITLE, title);
      fs.putExtra(FullScreenAlertActivity.EXTRA_BODY, body);
      fs.putExtra(FullScreenAlertActivity.EXTRA_SEVERITY, severity);
      fs.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
      fullScreen = PendingIntent.getActivity(this, id, fs, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    Intent open = new Intent(this, MainActivity.class);
    open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    open.putExtra(MainActivity.EXTRA_OPEN_ALERTS, true);
    PendingIntent content = PendingIntent.getActivity(this, id + 500, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

    NotificationCompat.Builder builder =
        new NotificationCompat.Builder(this, channelId)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setColor(NotificationChannels.severityColor(severity))
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setWhen(System.currentTimeMillis())
            .setShowWhen(true)
            .setContentIntent(content);

    if (silent) builder.setSilent(true);
    if (fullScreen != null) builder.setFullScreenIntent(fullScreen, true);

    try {
      NotificationManagerCompat.from(this).notify(NOTIFICATION_TAG, id, builder.build());
    } catch (SecurityException ignored) {
      // POST_NOTIFICATIONS not granted.
    }
  }

  private boolean canUseFullScreenIntent() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return true;
    NotificationManager manager = getSystemService(NotificationManager.class);
    return manager != null && manager.canUseFullScreenIntent();
  }

  private boolean shouldUseFullScreenIntent() {
    if (!canUseFullScreenIntent()) return false;
    PowerManager powerManager = getSystemService(PowerManager.class);
    boolean interactive = powerManager != null && powerManager.isInteractive();
    KeyguardManager keyguardManager = getSystemService(KeyguardManager.class);
    boolean locked = keyguardManager != null && keyguardManager.isKeyguardLocked();
    return !interactive || locked;
  }

  private boolean isInteractiveAndUnlocked() {
    PowerManager powerManager = getSystemService(PowerManager.class);
    if (powerManager == null || !powerManager.isInteractive()) return false;
    KeyguardManager keyguardManager = getSystemService(KeyguardManager.class);
    return keyguardManager == null || !keyguardManager.isKeyguardLocked();
  }

  private void startAlarm(String title, String body, String severity, int id, boolean sound, boolean showOverlay) {
    Intent alarm = new Intent(this, AlertForegroundService.class);
    alarm.setAction(AlertForegroundService.ACTION_START_ALERT);
    alarm.putExtra(AlertForegroundService.EXTRA_TITLE, title);
    alarm.putExtra(AlertForegroundService.EXTRA_BODY, body);
    alarm.putExtra(AlertForegroundService.EXTRA_SEVERITY, severity);
    alarm.putExtra(AlertForegroundService.EXTRA_ALERT_ID, id);
    alarm.putExtra(AlertForegroundService.EXTRA_SOUND, sound);
    alarm.putExtra(AlertForegroundService.EXTRA_SHOW_OVERLAY, showOverlay);
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        startForegroundService(alarm);
      } else {
        startService(alarm);
      }
    } catch (Exception e) {
      Log.e(TAG, "Could not start alert foreground service", e);
      // Last resort: re-post on the fallback channel, which itself plays a sound.
      NotificationManagerCompat.from(this).cancel(NOTIFICATION_TAG, id);
      postAlertNotification(
          id,
          title,
          body,
          severity,
          "/alerts",
          NotificationChannels.FALLBACK_CHANNEL_ID,
          false,
          !sound);
    }
  }

  private static int parseId(String raw) {
    try {
      return Integer.parseInt(raw);
    } catch (NumberFormatException e) {
      return (int) (raw.hashCode() & 0x7fffffff);
    }
  }

  private static String toAlertJson(
      int id,
      String title,
      String body,
      String severity,
      String url,
      boolean sound,
      String createdAt,
      String expiresAt) {
    StringBuilder sb = new StringBuilder("{\"alertId\":");
    sb.append(id);
    sb.append(",\"title\":").append(jsonEscape(title));
    sb.append(",\"message\":").append(jsonEscape(body));
    sb.append(",\"severity\":").append(jsonEscape(severity));
    sb.append(",\"url\":").append(jsonEscape(url));
    sb.append(",\"createdAt\":").append(jsonEscape(createdAt));
    sb.append(",\"expiresAt\":").append(expiresAt == null ? "null" : jsonEscape(expiresAt));
    sb.append(",\"sound\":").append(sound).append("}");
    return sb.toString();
  }

  private static String currentTimestamp() {
    return new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", Locale.US)
        .format(new java.util.Date());
  }

  private static String jsonEscape(String value) {
    if (value == null) return "\"\"";
    StringBuilder sb = new StringBuilder("\"");
    for (int i = 0; i < value.length(); i++) {
      char c = value.charAt(i);
      switch (c) {
        case '"':
          sb.append("\\\"");
          break;
        case '\\':
          sb.append("\\\\");
          break;
        case '\n':
          sb.append("\\n");
          break;
        case '\r':
          sb.append("\\r");
          break;
        case '\t':
          sb.append("\\t");
          break;
        default:
          if (c < 0x20) {
            sb.append(String.format(Locale.US, "\\u%04x", (int) c));
          } else {
            sb.append(c);
          }
      }
    }
    sb.append("\"");
    return sb.toString();
  }

  private static String firstNonEmpty(String... values) {
    for (String v : values) {
      if (v != null && !v.isEmpty()) return v;
    }
    return "";
  }
}