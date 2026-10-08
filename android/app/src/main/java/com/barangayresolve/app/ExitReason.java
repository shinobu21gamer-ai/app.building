package com.barangayresolve.app;

import android.app.ActivityManager;
import android.app.ApplicationExitInfo;
import android.content.Context;
import android.os.Build;
import android.os.Process;
import android.util.Log;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * Why the previous run of this app ended.
 *
 * "The app closes and nothing explains it" has several causes that look
 * identical on a phone: a Java crash, a native crash, an ANR, Android
 * reclaiming memory, or an OEM battery killer. Most of them never reach an
 * uncaught-exception handler, so this asks Android itself
 * ({@link ApplicationExitInfo}, API 30+) and reports the answer, including the
 * system's own description of the kill.
 */
public final class ExitReason {

  private static final String TAG = "ExitReason";

  /** Wall-clock time this process started; earlier exits are someone else's run. */
  private static volatile long processStartedAt = 0L;

  private ExitReason() {}

  /** Called once from {@link BarangayResolveApp#onCreate()}. */
  public static void markProcessStart() {
    processStartedAt = System.currentTimeMillis();
  }

  /** Human-readable report of the last exit, or null when nothing is available. */
  public static String describeLastExit(Context context) {
    Exit exit = lastExit(context);
    return exit == null ? null : exit.label;
  }

  public static boolean isAbnormal(Context context) {
    Exit exit = lastExit(context);
    return exit != null && exit.abnormal;
  }

  /** JSON for the web layer (see {@code AlertBridge.lastExitReport()}). */
  public static String lastExitJson(Context context) {
    Exit exit = lastExit(context);
    if (exit == null) return null;
    return "{"
        + "\"reason\":" + Js.quote(exit.reason)
        + ",\"label\":" + Js.quote(exit.label)
        + ",\"description\":" + Js.quote(exit.description)
        + ",\"at\":" + Js.quote(exit.at)
        + ",\"abnormal\":" + exit.abnormal
        + "}";
  }

  private static Exit lastExit(Context context) {
    if (context == null) return null;
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return null;

    try {
      ActivityManager manager = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
      if (manager == null) return null;

      List<ApplicationExitInfo> history =
          manager.getHistoricalProcessExitReasons(context.getPackageName(), 0, 10);
      if (history == null) return null;

      long reference = processStartedAt > 0 ? processStartedAt : System.currentTimeMillis();

      for (ApplicationExitInfo info : history) {
        if (info == null) continue;
        // The current process shows up in this list too (or a newer restart of it).
        if (info.getPid() == Process.myPid()) continue;
        if (info.getTimestamp() >= reference) continue;

        Exit exit = new Exit();
        exit.reason = reasonName(info.getReason());
        exit.description = safeDescription(info);
        exit.at = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US)
            .format(new Date(info.getTimestamp()));
        exit.abnormal = isAbnormalReason(info.getReason());
        exit.label = describe(exit, info);
        return exit;
      }
    } catch (Throwable error) {
      // Some OEM builds restrict this API; it is diagnostics only.
      Log.e(TAG, "could not read the exit history", error);
    }
    return null;
  }

  private static String describe(Exit exit, ApplicationExitInfo info) {
    StringBuilder sb = new StringBuilder();
    sb.append("Android reported that the previous run ended because: ")
        .append(exit.reason)
        .append(" (")
        .append(exit.at)
        .append(", importance ")
        .append(info.getImportance())
        .append(")");
    if (exit.description != null && !exit.description.isEmpty()) {
      sb.append("\n").append(exit.description);
    }
    return sb.toString();
  }

  private static String safeDescription(ApplicationExitInfo info) {
    try {
      return info.getDescription();
    } catch (Throwable error) {
      return null;
    }
  }

  private static boolean isAbnormalReason(int reason) {
    if (reason == ApplicationExitInfo.REASON_CRASH) return true;
    if (reason == ApplicationExitInfo.REASON_CRASH_NATIVE) return true;
    if (reason == ApplicationExitInfo.REASON_ANR) return true;
    if (reason == ApplicationExitInfo.REASON_LOW_MEMORY) return true;
    if (reason == ApplicationExitInfo.REASON_INITIALIZATION_FAILURE) return true;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
        && reason == ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE) {
      return true;
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && reason == ApplicationExitInfo.REASON_SIGNALED) {
      return true;
    }
    return false;
  }

  private static String reasonName(int reason) {
    if (reason == ApplicationExitInfo.REASON_CRASH) return "a crash in the app (Java)";
    if (reason == ApplicationExitInfo.REASON_CRASH_NATIVE) return "a crash inside the native code";
    if (reason == ApplicationExitInfo.REASON_ANR) return "the app stopped responding (ANR)";
    if (reason == ApplicationExitInfo.REASON_LOW_MEMORY) return "Android ran out of memory";
    if (reason == ApplicationExitInfo.REASON_INITIALIZATION_FAILURE) return "a failed startup";
    if (reason == ApplicationExitInfo.REASON_USER_REQUESTED) return "the user closed the app";
    if (reason == ApplicationExitInfo.REASON_USER_STOPPED) return "the user forced-stop the app";
    if (reason == ApplicationExitInfo.REASON_PERMISSION_CHANGE) return "a permission change";
    if (reason == ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE) {
      return "Android judged it to use too many resources";
    }
    if (reason == ApplicationExitInfo.REASON_SIGNALED) return "the process received a fatal signal";
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && reason == ApplicationExitInfo.REASON_FREEZER) {
      return "the app was frozen in the background";
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
        && reason == ApplicationExitInfo.REASON_PACKAGE_STATE_CHANGE) {
      return "the app's package state changed";
    }
    return "an unknown reason (code " + reason + ")";
  }

  private static final class Exit {
    String reason;
    String description;
    String at;
    String label;
    boolean abnormal;
  }
}
