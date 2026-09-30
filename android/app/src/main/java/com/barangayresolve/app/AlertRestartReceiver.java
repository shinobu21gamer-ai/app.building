package com.barangayresolve.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

/**
 * Restarts the alert alarm after the app process is killed (swiped away) or the
 * device reboots. The alarm state is persisted in SharedPreferences so the
 * service can be brought back with the same alert.
 *
 * A manifest-registered receiver is required: when an app is force-stopped,
 * Android does not deliver broadcasts to receivers registered in code, only to
 * those declared in the manifest.
 */
public class AlertRestartReceiver extends BroadcastReceiver {

  private static final String TAG = "AlertRestart";
  private static final String PREFS = "barangayresolve.alert";
  private static final String KEY_ALERT_ID = "alert_id";
  private static final String KEY_TITLE = "title";
  private static final String KEY_BODY = "body";
  private static final String KEY_SEVERITY = "severity";

  @Override
  public void onReceive(Context context, Intent intent) {
    SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    int alertId = prefs.getInt(KEY_ALERT_ID, -1);
    if (alertId == -1) return;

    String title = prefs.getString(KEY_TITLE, "BarangayResolve Alert");
    String body = prefs.getString(KEY_BODY, "");
    String severity = prefs.getString(KEY_SEVERITY, "INFO");

    Log.i(TAG, "Restarting alarm for alert " + alertId + " after " + intent.getAction());

    Intent alarm = new Intent(context, AlertForegroundService.class);
    alarm.setAction(AlertForegroundService.ACTION_START_ALERT);
    alarm.putExtra(AlertForegroundService.EXTRA_ALERT_ID, alertId);
    alarm.putExtra(AlertForegroundService.EXTRA_TITLE, title);
    alarm.putExtra(AlertForegroundService.EXTRA_BODY, body);
    alarm.putExtra(AlertForegroundService.EXTRA_SEVERITY, severity);

    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(alarm);
      } else {
        context.startService(alarm);
      }
    } catch (Exception e) {
      Log.e(TAG, "Could not restart alarm service", e);
    }
  }

  /** Persists the active alarm so it can be restarted after the app is killed. */
  static void saveActiveAlert(Context context, int alertId, String title, String body, String severity) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit()
        .putInt(KEY_ALERT_ID, alertId)
        .putString(KEY_TITLE, title)
        .putString(KEY_BODY, body)
        .putString(KEY_SEVERITY, severity)
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
        .apply();
  }
}