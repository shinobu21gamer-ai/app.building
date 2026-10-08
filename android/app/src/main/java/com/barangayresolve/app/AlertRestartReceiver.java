package com.barangayresolve.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

/**
 * Restores an active alert after a normal device reboot or package update. Android
 * does not deliver FCM/broadcasts to a force-stopped app until the user opens it again.
 * The foreground service also uses the saved state when Android restarts it with a
 * null START_STICKY intent.
 */
public class AlertRestartReceiver extends BroadcastReceiver {

  private static final String TAG = "AlertRestart";
  private static final String PREFS = "barangayresolve.alert";
  private static final String KEY_ALERT_ID = "alert_id";
  private static final String KEY_TITLE = "title";
  private static final String KEY_BODY = "body";
  private static final String KEY_SEVERITY = "severity";
  private static final String KEY_SOUND = "sound";
  private static final String KEY_SHOW_OVERLAY = "show_overlay";

  @Override
  public void onReceive(Context context, Intent intent) {
    Intent alarm = restoreActiveAlertIntent(context);
    if (alarm == null) return;

    Log.i(TAG, "Restoring alarm " + alarm.getIntExtra(AlertForegroundService.EXTRA_ALERT_ID, -1)
        + " after " + (intent == null ? "unknown event" : intent.getAction()));
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(alarm);
      } else {
        context.startService(alarm);
      }
    } catch (Exception e) {
      Log.e(TAG, "Could not restart alert service", e);
    }
  }

  static boolean hasActiveAlert(Context context) {
    return getActiveAlertId(context) != -1;
  }

  static int getActiveAlertId(Context context) {
    SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    return prefs.getInt(KEY_ALERT_ID, -1);
  }

  static Intent restoreActiveAlertIntent(Context context) {
    SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    int alertId = prefs.getInt(KEY_ALERT_ID, -1);
    if (alertId == -1) return null;

    Intent alarm = new Intent(context, AlertForegroundService.class);
    alarm.setAction(AlertForegroundService.ACTION_START_ALERT);
    alarm.putExtra(AlertForegroundService.EXTRA_ALERT_ID, alertId);
    alarm.putExtra(
        AlertForegroundService.EXTRA_TITLE,
        prefs.getString(KEY_TITLE, "BarangayResolve Alert"));
    alarm.putExtra(AlertForegroundService.EXTRA_BODY, prefs.getString(KEY_BODY, ""));
    alarm.putExtra(AlertForegroundService.EXTRA_SEVERITY, prefs.getString(KEY_SEVERITY, "INFO"));
    alarm.putExtra(AlertForegroundService.EXTRA_SOUND, prefs.getBoolean(KEY_SOUND, true));
    // The service rechecks screen/keyguard state before restoring an overlay.
    alarm.putExtra(
        AlertForegroundService.EXTRA_SHOW_OVERLAY, prefs.getBoolean(KEY_SHOW_OVERLAY, false));
    return alarm;
  }

  /** Persists the active alarm so it can be restarted after the app is killed. */
  static void saveActiveAlert(
      Context context,
      int alertId,
      String title,
      String body,
      String severity,
      boolean sound,
      boolean showOverlay) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit()
        .putInt(KEY_ALERT_ID, alertId)
        .putString(KEY_TITLE, title)
        .putString(KEY_BODY, body)
        .putString(KEY_SEVERITY, severity)
        .putBoolean(KEY_SOUND, sound)
        .putBoolean(KEY_SHOW_OVERLAY, showOverlay)
        .apply();
  }

  /** Clears the persisted alarm once it has been acknowledged or silenced. */
  static void clearActiveAlert(Context context) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit()
        .remove(KEY_ALERT_ID)
        .remove(KEY_TITLE)
        .remove(KEY_BODY)
        .remove(KEY_SEVERITY)
        .remove(KEY_SOUND)
        .remove(KEY_SHOW_OVERLAY)
        .apply();
  }
}