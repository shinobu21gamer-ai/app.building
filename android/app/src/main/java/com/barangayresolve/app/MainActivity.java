package com.barangayresolve.app;

import android.Manifest;
import android.app.KeyguardManager;
import android.app.NotificationManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Log;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

import java.io.IOException;
import java.io.InputStream;
import java.lang.ref.WeakReference;

public class MainActivity extends BridgeActivity {

  public static final String EXTRA_OPEN_ALERTS = "openAlerts";

  private static final String TAG = "MainActivity";

  /**
   * Written by `npx cap sync android` into the APK's assets. It carries
   * server.url - the deployed origin this WebView shell loads. When it is
   * missing the bridge falls back to the (empty) local bundle and the app would
   * show a blank screen, so we surface that instead.
   */
  private static final String CAPACITOR_CONFIG_ASSET = "capacitor.config.json";

  private static final int OVERLAY_PERMISSION_REQUEST_CODE = 1234;
  private static final int NOTIFICATION_PERMISSION_REQUEST_CODE = 1235;
  private static final int FULL_SCREEN_INTENT_PERMISSION_REQUEST_CODE = 1236;
  private static final String ALERT_PERMISSION_PREFS = "barangayresolve.alert.permissions";
  private static final String KEY_PERMISSION_FLOW_PROMPTED = "permission_flow_prompted";

  private static WeakReference<MainActivity> sCurrent = new WeakReference<>(null);
  private static volatile boolean sResumed = false;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    try {
      super.onCreate(savedInstanceState);
    } catch (Throwable error) {
      // A failure inside the Capacitor bridge would otherwise close the app
      // with no explanation. Show what happened instead.
      reportStartupFailure("The app could not start", error);
      return;
    }

    try {
      if (!hasCapacitorConfig()) {
        reportStartupFailure(
            "This build is incomplete",
            "The APK is missing capacitor.config.json, so it has no address to load.\n\n"
                + "Rebuild it with `npm run android:apk` (which runs `npx cap sync android` first).",
            null);
        return;
      }

      // Ensure the WebView persists cookies to disk so the session survives restarts.
      CookieManager cookies = CookieManager.getInstance();
      cookies.setAcceptCookie(true);
      WebView webView = getBridge() == null ? null : getBridge().getWebView();
      if (webView != null) {
        cookies.setAcceptThirdPartyCookies(webView, true);
      }

      NotificationChannels.ensure(this);
      attachWebViewGuards();
      boolean prompted = getSharedPreferences(ALERT_PERMISSION_PREFS, MODE_PRIVATE)
          .getBoolean(KEY_PERMISSION_FLOW_PROMPTED, false);
      if (!prompted) {
        getSharedPreferences(ALERT_PERMISSION_PREFS, MODE_PRIVATE)
            .edit()
            .putBoolean(KEY_PERMISSION_FLOW_PROMPTED, true)
            .apply();
        requestAlertDisplayPermissions();
      }
    } catch (Throwable error) {
      reportStartupFailure("The app could not finish starting", error);
    }
  }

  @Override
  public void onResume() {
    try {
      super.onResume();
      sCurrent = new WeakReference<>(this);
      sResumed = true;

      attachAlertBridge();

      if (getIntent() != null && getIntent().getBooleanExtra(EXTRA_OPEN_ALERTS, false)) {
        getIntent().removeExtra(EXTRA_OPEN_ALERTS);
        // The web layer polls on mount and surfaces whatever is still active.
      }
    } catch (Throwable error) {
      reportStartupFailure("The app could not resume", error);
    }
  }

  @Override
  public void onPause() {
    super.onPause();
    sResumed = false;
    // Force cookies to disk so the session survives the app being killed.
    // Without this, the WebView keeps cookies only in memory and a force-stop
    // logs the user out.
    try {
      CookieManager.getInstance().flush();
    } catch (Exception ignored) {
    }
  }

  /**
   * Installs the guards that keep the shell alive when something underneath it
   * fails, and exposes the bridge object to the web layer.
   *
   * The renderer callback matters most: when the WebView's renderer process dies
   * (a crash inside Chromium, or Android reclaiming memory) nothing handles the
   * event by default, so Android kills the whole app - one of the ways this app
   * used to "close without any warning". Handling it means the report is saved
   * and the activity rebuilds itself instead.
   */
  private void attachWebViewGuards() {
    Bridge bridge = getBridge();
    if (bridge == null) return;

    try {
      bridge.addWebViewListener(
          new WebViewListener() {
            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
              boolean crashed = detail != null && detail.didCrash();
              CrashLog.record(
                  MainActivity.this,
                  "webview",
                  "The web view stopped "
                      + (crashed
                          ? "(renderer crash)"
                          : "(closed by the system, usually low memory)")
                      + ". The app reloaded itself instead of closing.");
              if (view != null) {
                view.post(
                    () -> {
                      try {
                        if (!isFinishing() && !isDestroyed()) recreate();
                      } catch (Throwable ignored) {
                        // Nothing else to do - the report on disk is the record.
                      }
                    });
              }
              return true;
            }
          });
    } catch (Throwable error) {
      Log.e(TAG, "could not install the web view guard", error);
    }

    attachAlertBridge();
  }

  /** Publishes the {@code window.AlertBridge} object to the current page. */
  private void attachAlertBridge() {
    Bridge bridge = getBridge();
    WebView webView = bridge == null ? null : bridge.getWebView();
    if (webView == null) return;
    try {
      webView.addJavascriptInterface(new AlertBridge(), "AlertBridge");
    } catch (Throwable error) {
      Log.e(TAG, "could not attach the alert bridge", error);
    }
  }

  /** True when the packaged capacitor.config.json exists in this APK. */
  private boolean hasCapacitorConfig() {
    try (InputStream ignored = getAssets().open(CAPACITOR_CONFIG_ASSET)) {
      return true;
    } catch (IOException error) {
      Log.e(TAG, "packaged " + CAPACITOR_CONFIG_ASSET + " is missing", error);
      return false;
    }
  }

  /**
   * Replaces the WebView with a readable message when startup fails, so a broken
   * build can never look like "the app opens and immediately closes" with no clue.
   */
  private void reportStartupFailure(String headline, Throwable error) {
    reportStartupFailure(headline, null, error);
  }

  private void reportStartupFailure(String headline, String detail, Throwable error) {
    if (error != null) {
      Log.e(TAG, headline, error);
    } else {
      Log.e(TAG, headline + ": " + detail);
    }

    String message = detail;
    if (message == null) {
      message = String.valueOf(error);
    }

    try {
      int pad = (int) (24 * getResources().getDisplayMetrics().density);

      LinearLayout root = new LinearLayout(this);
      root.setOrientation(LinearLayout.VERTICAL);
      root.setPadding(pad, pad, pad, pad);
      root.setBackgroundColor(0xFF0F172A);

      TextView title = new TextView(this);
      title.setTextColor(0xFFFFFFFF);
      title.setTextSize(20f);
      title.setText(headline);
      root.addView(title);

      TextView body = new TextView(this);
      body.setTextColor(0xFFE2E8F0);
      body.setTextSize(13f);
      body.setPadding(0, pad / 2, 0, pad / 2);
      body.setText(message);
      root.addView(body);

      Button retry = new Button(this);
      retry.setText("Try again");
      retry.setOnClickListener(view -> recreate());
      root.addView(retry);

      setContentView(root);
    } catch (Throwable ignored) {
      // Nothing else we can do - the log line above is the record.
    }
  }

  @Override
  public void onDestroy() {
    super.onDestroy();
    if (sCurrent.get() == this) sCurrent.clear();
  }

  public class AlertBridge {
    @JavascriptInterface
    public void stopAlertSound() {
      // Legacy web silence — stop the current alarm but keep its notification.
      AlertForegroundService.stop(MainActivity.this, -1, false);
    }

    @JavascriptInterface
    public void stopAlertSoundFor(int alertId) {
      // Silence only this alert; leave its notification available for later ack.
      AlertForegroundService.stop(MainActivity.this, alertId, false);
    }

    @JavascriptInterface
    public void stopAlertFor(int alertId) {
      // Server-confirmed acknowledgement — stop this alarm and clear its notification.
      AlertForegroundService.stop(MainActivity.this, alertId, true);
    }

    @JavascriptInterface
    public void startAlertFor(int alertId, String title, String body, String severity, boolean sound) {
      Intent alarm = new Intent(MainActivity.this, AlertForegroundService.class);
      alarm.setAction(AlertForegroundService.ACTION_START_ALERT);
      alarm.putExtra(AlertForegroundService.EXTRA_ALERT_ID, alertId);
      alarm.putExtra(AlertForegroundService.EXTRA_TITLE, title);
      alarm.putExtra(AlertForegroundService.EXTRA_BODY, body);
      alarm.putExtra(AlertForegroundService.EXTRA_SEVERITY, severity);
      alarm.putExtra(AlertForegroundService.EXTRA_SOUND, sound);
      // The web alert dialog is already visible while the app is foreground.
      alarm.putExtra(AlertForegroundService.EXTRA_SHOW_OVERLAY, false);
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          startForegroundService(alarm);
        } else {
          startService(alarm);
        }
      } catch (Exception ignored) {
        // The web alert remains visible if Android blocks starting the service.
      }
    }

    @JavascriptInterface
    public void setSessionActive(boolean active) {
      // The web layer owns the truth about the session; the native alarm layer
      // can only read it through this mirror.
      SessionState.setSignedIn(MainActivity.this, active);
    }

    @JavascriptInterface
    public void openAlertPermissions() {
      runOnUiThread(() -> {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
          requestPermissions(
              new String[] {Manifest.permission.POST_NOTIFICATIONS},
              NOTIFICATION_PERMISSION_REQUEST_CODE);
          return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(MainActivity.this)) {
          requestOverlayPermission();
          return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
          NotificationManager manager = getSystemService(NotificationManager.class);
          if (manager != null && !manager.canUseFullScreenIntent()) {
            requestFullScreenIntentAccess();
            return;
          }
        }
        Intent intent;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
          intent.putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName());
        } else {
          intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
          intent.setData(android.net.Uri.parse("package:" + getPackageName()));
        }
        try {
          startActivity(intent);
        } catch (Exception ignored) {
          // The Android settings panel is device-specific.
        }
      });
    }

    @JavascriptInterface
    public void openAlertsPage() {
      // Navigate to alerts page in the web app.
      dispatchToWeb("try{window.location.href='/alerts'}catch(e){}");
    }

    /**
     * Push-alert status of this build: whether Firebase is configured, the last
     * registration error, and the last token. Returned as JSON so the web layer
     * can show (and copy) exactly what went wrong.
     */
    @JavascriptInterface
    public String pushDiagnostics() {
      try {
        return PushSupport.diagnostics(MainActivity.this);
      } catch (Throwable error) {
        CrashLog.record(MainActivity.this, "push-diagnostics", error);
        return "{\"available\":false,\"reason\":\"The app could not read its push state.\"}";
      }
    }

    /**
     * Registers this device for FCM inside the app's own try/catch. Preferred
     * over the Capacitor plugin, whose unhandled exception on a misconfigured
     * build closes the app.
     */
    @JavascriptInterface
    public void requestPushToken() {
      PushSupport.requestToken(MainActivity.this);
    }

    /** The last fatal problem (crash or explained failure), or null when clean. */
    @JavascriptInterface
    public String crashReport() {
      try {
        return CrashLog.read(MainActivity.this);
      } catch (Throwable error) {
        return null;
      }
    }

    /** Called once the user has seen the report. */
    @JavascriptInterface
    public void clearCrashReport() {
      CrashLog.clear(MainActivity.this);
    }

    /**
     * Why Android says the previous run of this app ended (crash, ANR, memory
     * kill, user swipe), as JSON, or null when that information is unavailable.
     * This is what explains the closes that never reach a crash handler.
     */
    @JavascriptInterface
    public String lastExitReport() {
      try {
        return ExitReason.lastExitJson(MainActivity.this);
      } catch (Throwable error) {
        return null;
      }
    }
  }

  private void requestAlertDisplayPermissions() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
        && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED) {
      requestPermissions(
          new String[] {Manifest.permission.POST_NOTIFICATIONS},
          NOTIFICATION_PERMISSION_REQUEST_CODE);
      return;
    }
    requestOverlayPermission();
  }

  private void requestOverlayPermission() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this)) {
      Intent intent =
          new Intent(
              Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
              android.net.Uri.parse("package:" + getPackageName()));
      try {
        startActivityForResult(intent, OVERLAY_PERMISSION_REQUEST_CODE);
      } catch (Exception ignored) {
        // Device-specific settings panel is unavailable; normal notifications remain usable.
      }
      return;
    }
    requestFullScreenIntentAccess();
  }

  private void requestFullScreenIntentAccess() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return;
    NotificationManager manager = getSystemService(NotificationManager.class);
    if (manager == null || manager.canUseFullScreenIntent()) return;

    Intent intent = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT);
    intent.setData(android.net.Uri.parse("package:" + getPackageName()));
    try {
      startActivityForResult(intent, FULL_SCREEN_INTENT_PERMISSION_REQUEST_CODE);
    } catch (Exception ignored) {
      // Full-screen access remains optional; lock-screen notifications still work.
    }
  }

  @Override
  public void onRequestPermissionsResult(
      int requestCode, String[] permissions, int[] grantResults) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    if (requestCode == NOTIFICATION_PERMISSION_REQUEST_CODE) {
      // Continue the guided setup even if notifications were declined: overlay
      // access can still provide a popup while the app is in the background.
      requestOverlayPermission();
    }
  }

  @Override
  protected void onActivityResult(int requestCode, int resultCode, Intent data) {
    super.onActivityResult(requestCode, resultCode, data);
    if (requestCode == OVERLAY_PERMISSION_REQUEST_CODE) {
      requestFullScreenIntentAccess();
    }
  }

  // ---- Web bridge helpers used by native services ----

  public static boolean isForeground() {
    MainActivity activity = sCurrent.get();
    return sResumed && activity != null;
  }

  /** Only route an alert to the WebView when it is actually visible and unlocked. */
  public static boolean canHandleAlertInWeb(android.content.Context context) {
    if (!isForeground()) return false;
    PowerManager powerManager = context.getSystemService(PowerManager.class);
    if (powerManager == null || !powerManager.isInteractive()) return false;
    KeyguardManager keyguardManager = context.getSystemService(KeyguardManager.class);
    return keyguardManager == null || !keyguardManager.isKeyguardLocked();
  }

  /** Evaluates JS on the WebView if one exists; returns false otherwise. */
  public static boolean dispatchToWeb(String js) {
    MainActivity activity = sCurrent.get();
    if (activity == null) return false;
    WebView webView = activity.getBridge() == null ? null : activity.getBridge().getWebView();
    if (webView == null) return false;
    webView.post(
        () -> {
          try {
            webView.evaluateJavascript(js, null);
          } catch (Exception ignored) {
          }
        });
    return true;
  }

  /** Pushes a native alert payload into the web alert queue ({@code native-push-received}). */
  public static void dispatchToNativePush(String alertJson) {
    dispatchToWeb(
        "try{window.dispatchEvent(new CustomEvent('native-push-received',{detail:"
            + alertJson
            + "}))}catch(e){}");
  }
}