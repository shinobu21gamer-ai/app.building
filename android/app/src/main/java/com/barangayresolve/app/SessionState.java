package com.barangayresolve.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

/**
 * Durable mirror of the web session, written by the WebView through
 * {@code AlertBridge.setSessionActive}.
 *
 * The alert alarm lives in {@link AlertForegroundService}, which Android can
 * start from an FCM message while the app is backgrounded or its process has
 * been killed — so it cannot read the WebView's cookies to find out whether
 * anybody is signed in. This flag is that bridge.
 *
 * The stored state is deliberately tri-state. Until the web layer reports in,
 * delivery keeps its historical behaviour; only an explicit "signed out"
 * suppresses alarms. A WebView that fails to report can therefore never
 * silently disable alerts for a signed-in user.
 */
public final class SessionState {

  private static final String TAG = "SessionState";

  private static final String PREFS = "barangayresolve.session";
  private static final String KEY_STATE = "state";

  /** The web layer has not reported a session yet. */
  public static final int UNKNOWN = 0;
  public static final int SIGNED_IN = 1;
  public static final int SIGNED_OUT = 2;

  private SessionState() {}

  /**
   * Records whether a user is signed in. Signing out also tears down any alarm
   * that is currently ringing and forgets the saved alert, so an alert the user
   * can no longer acknowledge cannot survive a reboot.
   */
  public static void setSignedIn(Context context, boolean signedIn) {
    int state = signedIn ? SIGNED_IN : SIGNED_OUT;
    // The web layer re-reports on every page load; only a real transition needs
    // a synchronous disk write or alarm teardown.
    if (getState(context) == state) return;

    // commit() rather than apply(): the flag has to survive an immediate process
    // death, which is exactly when an in-flight FCM message would be delivered.
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit()
        .putInt(KEY_STATE, state)
        .commit();

    if (!signedIn) {
      Log.i(TAG, "Session signed out: silencing the active alert alarm.");
      int activeId = AlertRestartReceiver.getActiveAlertId(context);
      AlertForegroundService.stop(context, activeId == -1 ? -1 : activeId, activeId != -1);
      AlertRestartReceiver.clearActiveAlert(context);
    }
  }

  public static int getState(Context context) {
    return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .getInt(KEY_STATE, UNKNOWN);
  }

  /** Whether this device may raise an alert alarm right now. */
  public static boolean deliveryAllowed(Context context) {
    return getState(context) != SIGNED_OUT;
  }
}
