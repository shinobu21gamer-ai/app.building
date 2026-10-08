package com.barangayresolve.app;

import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * Shared action handler for the native alert popups (overlay + full-screen activity).
 * "OK, I understand" asks the WebView to acknowledge on the server. The alarm is
 * stopped only after the server confirms; otherwise it remains active and retryable.
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
    if (!delivered || !MainActivity.isForeground()) {
      Intent open = new Intent(context, MainActivity.class);
      open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
      open.putExtra(MainActivity.EXTRA_OPEN_ALERTS, true);
      try {
        context.startActivity(open);
      } catch (Exception e) {
        Log.w(TAG, "Could not reopen app after ack", e);
      }
    }
    // Do not stop/cancel before the WebView confirms the server-side acknowledgement.
  }

  public static void silence(Context context, int alertId) {
    AlertForegroundService.stop(context, alertId, false);
  }
}