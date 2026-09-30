package com.barangayresolve.app;

import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * Shared action handler for the native alert popups (overlay + full-screen activity).
 * "OK, I understand" tries to acknowledge through the live WebView first (async API
 * call via the web layer) and falls back to just opening the app so the user can
 * acknowledge there.
 */
public final class AlertActions {

  private static final String TAG = "AlertActions";

  private AlertActions() {}

  public static void acknowledge(Context context, int alertId) {
    String js =
        "try{window.dispatchEvent(new CustomEvent('native-ack-requested',{detail:{id:"
            + alertId
            + "}}))}catch(e){}";
    boolean delivered = MainActivity.dispatchToWeb(js);
    Log.d(TAG, "acknowledge(" + alertId + ") delivered to web=" + delivered);
    if (!delivered) {
      Intent open = new Intent(context, MainActivity.class);
      open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
      open.putExtra(MainActivity.EXTRA_OPEN_ALERTS, true);
      try {
        context.startActivity(open);
      } catch (Exception e) {
        Log.w(TAG, "Could not reopen app after ack", e);
      }
    }
    AlertForegroundService.stop(context, alertId, true);
  }

  public static void silence(Context context, int alertId) {
    AlertForegroundService.stop(context, alertId, false);
  }
}