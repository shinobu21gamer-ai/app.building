package com.barangayresolve.app;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.content.IntentFilter;
import androidx.localbroadcastmanager.content.LocalBroadcastManager;

import com.getcapacitor.BridgeActivity;

import java.lang.ref.WeakReference;

public class MainActivity extends BridgeActivity {

  public static final String EXTRA_OPEN_ALERTS = "openAlerts";

  private static final int OVERLAY_PERMISSION_REQUEST_CODE = 1234;
  private static final int NOTIFICATION_PERMISSION_REQUEST_CODE = 1235;

  private static WeakReference<MainActivity> sCurrent = new WeakReference<>(null);
  private static volatile boolean sResumed = false;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    // Ensure the WebView persists cookies to disk so the session survives restarts.
    CookieManager cookies = CookieManager.getInstance();
    cookies.setAcceptCookie(true);
    cookies.setAcceptThirdPartyCookies(getBridge() == null ? null : getBridge().getWebView(), true);
    NotificationChannels.ensure(this);
    requestOverlayPermission();
    requestPostNotificationsPermission();
  }

  @Override
  public void onResume() {
    super.onResume();
    sCurrent = new WeakReference<>(this);
    sResumed = true;

    WebView webView = getBridge() == null ? null : getBridge().getWebView();
    if (webView != null) {
      webView.addJavascriptInterface(new AlertBridge(), "AlertBridge");
    }

    if (getIntent() != null && getIntent().getBooleanExtra(EXTRA_OPEN_ALERTS, false)) {
      getIntent().removeExtra(EXTRA_OPEN_ALERTS);
      // The web layer polls on mount and surfaces whatever is still active.
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

  @Override
  public void onDestroy() {
    super.onDestroy();
    if (sCurrent.get() == this) sCurrent.clear();
  }

  public class AlertBridge {
    @JavascriptInterface
    public void stopAlertSound() {
      // Web "silence" — stop the alarm but keep the alert unacknowledged.
      IntentReceiver.sendStop();
    }

    @JavascriptInterface
    public void stopAlertFor(int alertId) {
      // Web acknowledge — stop the alarm and clear this alert's notification.
      AlertForegroundService.stop(MainActivity.this, alertId, true);
    }
  }

  /** Thin indirection so the JS bridge cannot accidentally reference this activity after death. */
  private static final class IntentReceiver {
    static void sendStop() {
      MainActivity activity = sCurrent.get();
      if (activity == null) return;
      if (AlertForegroundService.isRunning()) {
        LocalBroadcastManager.getInstance(activity).sendBroadcast(new Intent(AlertForegroundService.ACTION_STOP_ALERT));
      }
    }
  }

  private void requestOverlayPermission() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this)) {
      Intent intent =
          new Intent(
              Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
              android.net.Uri.parse("package:" + getPackageName()));
      startActivityForResult(intent, OVERLAY_PERMISSION_REQUEST_CODE);
    }
  }

  private void requestPostNotificationsPermission() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return;
    if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
      requestPermissions(
          new String[] {Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_PERMISSION_REQUEST_CODE);
    }
  }

  @Override
  protected void onActivityResult(int requestCode, int resultCode, Intent data) {
    super.onActivityResult(requestCode, resultCode, data);
    // Set in onResume already; nothing extra to do.
  }

  // ---- Web bridge helpers used by native services ----

  public static boolean isForeground() {
    MainActivity activity = sCurrent.get();
    return sResumed && activity != null;
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