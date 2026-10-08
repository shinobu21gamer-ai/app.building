package com.barangayresolve.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * FCM registration owned by the app itself instead of the Capacitor plugin.
 *
 * Why this exists: {@code PushNotificationsPlugin.register()} calls
 * {@code FirebaseMessaging.getInstance()} on the bridge's background worker. When
 * a build has no Firebase configuration that call throws, Capacitor rethrows it
 * as an uncaught {@code RuntimeException}, Android kills the process, and the app
 * "closes without any warning" - exactly the failure this class removes.
 *
 * Registration here is checked first ({@link #unavailableReason(Context)}) and
 * every call is wrapped, so a phone that cannot register reports a readable
 * reason in the app instead of dying. The result travels over the same window
 * events the web layer already listens for ({@code native-token-refreshed}).
 */
public final class PushSupport {

  private static final String TAG = "PushSupport";

  private static final String PREFS = "barangayresolve.push";
  private static final String KEY_LAST_ERROR = "last_error";
  private static final String KEY_LAST_ERROR_AT = "last_error_at";
  private static final String KEY_LAST_TOKEN = "last_token";

  private static final String EVENT_TOKEN = "native-token-refreshed";
  private static final String EVENT_ERROR = "native-push-error";

  private PushSupport() {}

  /**
   * Null when this build can register for FCM, otherwise a sentence a phone user
   * can act on.
   */
  public static String unavailableReason(Context context) {
    if (context == null) return "The Android shell has no application context.";

    boolean configPresent = hasGoogleAppId(context);
    boolean firebaseInitialized;
    try {
      firebaseInitialized = !FirebaseApp.getApps(context).isEmpty();
    } catch (Throwable error) {
      Log.e(TAG, "could not read the Firebase app state", error);
      firebaseInitialized = false;
    }

    if (!configPresent) {
      return "This APK was built without android/app/google-services.json, so it has no "
          + "Firebase project to register with. Rebuild the APK with that file in place.";
    }
    if (!firebaseInitialized) {
      return "This build could not start Firebase from its google-services.json. The file's "
          + "package name must be com.barangayresolve.app.";
    }
    return null;
  }

  public static boolean isAvailable(Context context) {
    return unavailableReason(context) == null;
  }

  /** True when the packaged resources carry a Firebase app id. */
  private static boolean hasGoogleAppId(Context context) {
    try {
      return context.getResources().getIdentifier("google_app_id", "string", context.getPackageName())
          != 0;
    } catch (Throwable error) {
      return false;
    }
  }

  /**
   * Asks FCM for the device token. Never throws: every outcome is reported to the
   * web layer, and failures are kept for the diagnostics screen.
   */
  public static void requestToken(final Context context) {
    if (context == null) return;

    String reason = unavailableReason(context);
    if (reason != null) {
      recordError(context, reason);
      dispatchError(reason);
      return;
    }

    try {
      FirebaseMessaging messaging = FirebaseMessaging.getInstance();
      messaging.setAutoInitEnabled(true);
      messaging
          .getToken()
          .addOnCompleteListener(task -> {
            if (task.isSuccessful() && task.getResult() != null) {
              handleToken(context, task.getResult());
            } else {
              String message = describeFailure(task.getException());
              recordError(context, message);
              dispatchError(message);
            }
          });
    } catch (Throwable error) {
      // Includes the IllegalStateException a build without a Firebase project
      // throws: the app stays open and explains itself instead of crashing.
      String message = describeFailure(error);
      recordError(context, message);
      dispatchError(message);
    }
  }

  private static void handleToken(Context context, String token) {
    clearError(context);
    try {
      context
          .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
          .edit()
          .putString(KEY_LAST_TOKEN, token)
          .apply();
    } catch (Throwable ignored) {
    }
    Log.i(TAG, "FCM token acquired");
    MainActivity.dispatchToWeb(
        "try{window.dispatchEvent(new CustomEvent(\""
            + EVENT_TOKEN
            + "\",{detail:{token:"
            + Js.quote(token)
            + "}}))}catch(e){}");
  }

  private static void dispatchError(String message) {
    MainActivity.dispatchToWeb(
        "try{window.dispatchEvent(new CustomEvent(\""
            + EVENT_ERROR
            + "\",{detail:{message:"
            + Js.quote(message)
            + "}}))}catch(e){}");
  }

  /**
   * Turns the raw FCM/Play-services failure into something that points at a fix,
   * keeping the technical text at the end so it can still be reported verbatim.
   */
  private static String describeFailure(Throwable error) {
    String raw = null;
    if (error != null) {
      raw = error.getLocalizedMessage();
      if (raw == null || raw.isEmpty()) raw = error.toString();
    }
    if (raw == null || raw.isEmpty()) raw = "unknown error";

    String lower = raw.toLowerCase(Locale.US);
    String hint;

    if (lower.contains("firebaseapp is not initialized") || lower.contains("default firebaseapp")) {
      hint =
          "This APK has no working Firebase configuration, so it cannot receive push alerts. "
              + "Rebuild it with android/app/google-services.json for com.barangayresolve.app.";
    } else if (lower.contains("service_not_available")) {
      hint =
          "Google Play services could not reach Firebase (SERVICE_NOT_AVAILABLE). Check the "
              + "phone's connection and that this APK belongs to the same Firebase project as "
              + "google-services.json.";
    } else if (lower.contains("missing_instanceid_service")) {
      hint =
          "This APK is missing a Firebase component (MISSING_INSTANCEID_SERVICE), which usually "
              + "means the Google Services Gradle plugin was skipped. Rebuild with "
              + "android/app/google-services.json present.";
    } else if (lower.contains("invalid_sender") || lower.contains("sender")) {
      hint =
          "Firebase rejected the sender id (INVALID_SENDER): this APK's google-services.json "
              + "belongs to a different Firebase project than the one the server sends from.";
    } else if (lower.contains("api key") || lower.contains("api_key")) {
      hint =
          "Firebase rejected the API key. Check that google-services.json matches the Firebase "
              + "project and that FCM is enabled for it.";
    } else if (lower.contains("network") || lower.contains("timeout") || lower.contains("unavailable")) {
      hint =
          "The phone could not reach Firebase. Check the connection and try again - the token "
              + "is refreshed automatically.";
    } else {
      hint = "Push registration failed.";
    }

    return hint + " (Technical detail: " + raw + ")";
  }

  private static void recordError(Context context, String message) {
    Log.w(TAG, "push registration failed: " + message);
    try {
      context
          .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
          .edit()
          .putString(KEY_LAST_ERROR, message)
          .putString(KEY_LAST_ERROR_AT, now())
          .apply();
    } catch (Throwable ignored) {
    }
  }

  private static void clearError(Context context) {
    try {
      context
          .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
          .edit()
          .remove(KEY_LAST_ERROR)
          .remove(KEY_LAST_ERROR_AT)
          .apply();
    } catch (Throwable ignored) {
    }
  }

  /** What the web layer shows on the alert-diagnostics card. */
  public static String diagnostics(Context context) {
    String reason = unavailableReason(context);
    SharedPreferences prefs =
        context == null ? null : context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);

    return "{"
        + "\"available\":" + (reason == null)
        + ",\"reason\":" + Js.quote(reason)
        + ",\"firebaseInitialized\":" + (context != null && !isFirebaseEmpty(context))
        + ",\"configPresent\":" + (context != null && hasGoogleAppId(context))
        + ",\"lastError\":" + Js.quote(prefs == null ? null : prefs.getString(KEY_LAST_ERROR, null))
        + ",\"lastErrorAt\":" + Js.quote(prefs == null ? null : prefs.getString(KEY_LAST_ERROR_AT, null))
        + ",\"lastToken\":" + Js.quote(prefs == null ? null : prefs.getString(KEY_LAST_TOKEN, null))
        + ",\"sessionActive\":" + (context != null && SessionState.getState(context) == SessionState.SIGNED_IN)
        + ",\"generatedAt\":" + Js.quote(now())
        + "}";
  }

  private static boolean isFirebaseEmpty(Context context) {
    try {
      return FirebaseApp.getApps(context).isEmpty();
    } catch (Throwable error) {
      return true;
    }
  }

  private static String now() {
    return new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", Locale.US).format(new Date());
  }
}
