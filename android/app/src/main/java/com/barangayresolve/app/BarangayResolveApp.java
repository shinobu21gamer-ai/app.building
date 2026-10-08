package com.barangayresolve.app;

import android.app.Application;
import android.util.Log;

/**
 * Safety net for the one failure mode the phone build kept showing: the app
 * closing with no message at all.
 *
 * An uncaught exception on any thread kills the process before the WebView (or
 * the user) can react. Every such throwable is now written to
 * {@link CrashLog} first, so the next launch can show what happened.
 *
 * The single exception is the "FirebaseApp is not initialized" error thrown by
 * the push plugin on its background worker when a build has no Firebase project.
 * Push alerts are a feature the rest of the app can live without, so that one is
 * recorded and swallowed: the app keeps running and the web layer reports the
 * problem in the alerts screen instead of the user watching the app disappear.
 */
public class BarangayResolveApp extends Application {

  private static final String TAG = "BarangayResolveApp";

  @Override
  public void onCreate() {
    super.onCreate();

    // Needed before anything else: ExitReason compares saved exits against this
    // moment to know which run the user is asking about.
    ExitReason.markProcessStart();

    final Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();

    Thread.setDefaultUncaughtExceptionHandler(
        (thread, error) -> {
          String source = thread == null ? "native" : "native:" + thread.getName();

          if (isMissingFirebaseProject(error)) {
            Log.e(
                TAG,
                "Push registration hit a build without Firebase configuration; "
                    + "keeping the app alive and reporting it in-app instead.",
                error);
            CrashLog.record(this, "push-config", error);
            return;
          }

          CrashLog.record(this, source, error);
          if (previous != null) {
            // Normal crash behaviour, but now with a report waiting on disk.
            previous.uncaughtException(thread, error);
          }
        });
  }

  /** Matches the IllegalStateException Capacitor rethrows from the push plugin. */
  private static boolean isMissingFirebaseProject(Throwable error) {
    for (Throwable current = error; current != null; current = current.getCause()) {
      if (current instanceof IllegalStateException) {
        String message = current.getMessage();
        if (message != null && message.contains("FirebaseApp is not initialized")) {
          return true;
        }
      }
    }
    return false;
  }
}
