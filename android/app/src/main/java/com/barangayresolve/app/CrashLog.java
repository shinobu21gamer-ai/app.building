package com.barangayresolve.app;

import android.content.Context;
import android.util.Log;

import java.io.ByteArrayOutputStream;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Records the last fatal problem the native shell ran into so the app can show
 * it instead of closing without a word.
 *
 * The APK is a WebView shell with a handful of background services; when one of
 * them throws on a thread nobody is watching, Android kills the process and the
 * user sees the app "close for no reason". This class keeps the report on disk
 * (survives the kill) and the web layer reads it back through
 * {@code AlertBridge.crashReport()} so the failure is visible and reportable.
 */
public final class CrashLog {

  private static final String TAG = "CrashLog";
  private static final String FILE_NAME = "last-crash.txt";

  /** Keeps the report small enough to hand to JavaScript in one call. */
  private static final int MAX_CHARS = 4000;

  private CrashLog() {}

  /** Writes a report built from a throwable. */
  public static void record(Context context, String source, Throwable error) {
    record(context, source, describe(error));
  }

  /** Writes a report from a pre-formatted message. */
  public static void record(Context context, String source, String detail) {
    String message = detail == null || detail.isEmpty() ? "unknown error" : detail;
    Log.e(TAG, source + ": " + message);
    if (context == null) return;

    String stamp = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(new Date());
    String text = "[" + stamp + "] " + source + "\n" + message;
    try (FileOutputStream out = context.openFileOutput(FILE_NAME, Context.MODE_PRIVATE)) {
      out.write(text.getBytes(StandardCharsets.UTF_8));
    } catch (Exception error) {
      Log.e(TAG, "could not save the crash report", error);
    }
  }

  /** The saved report, or null when the last launch was clean. */
  public static String read(Context context) {
    if (context == null) return null;
    try (FileInputStream in = context.openFileInput(FILE_NAME)) {
      ByteArrayOutputStream buffer = new ByteArrayOutputStream();
      byte[] chunk = new byte[1024];
      int read;
      while ((read = in.read(chunk)) > 0) {
        buffer.write(chunk, 0, read);
      }
      String text = buffer.toString(StandardCharsets.UTF_8.name()).trim();
      return text.isEmpty() ? null : text;
    } catch (Exception error) {
      // No file at all is the normal case.
      return null;
    }
  }

  /** Called once the report has been shown to the user. */
  public static void clear(Context context) {
    if (context == null) return;
    try {
      context.deleteFile(FILE_NAME);
    } catch (Exception ignored) {
    }
  }

  /** Printable form of a throwable, trimmed to something a phone screen can show. */
  public static String describe(Throwable error) {
    if (error == null) return "unknown error";

    StringWriter writer = new StringWriter();
    PrintWriter printer = new PrintWriter(writer);
    try {
      error.printStackTrace(printer);
    } finally {
      printer.close();
    }

    String text = writer.toString();
    return text.length() > MAX_CHARS ? text.substring(0, MAX_CHARS) + "\n…" : text;
  }
}
