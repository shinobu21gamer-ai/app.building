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
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

import java.lang.ref.WeakReference;

public class MainActivity extends BridgeActivity {

  public static final String EXTRA_OPEN_ALERTS = "openAlerts";

  private static final int OVERLAY_PERMISSION_REQUEST_CODE = 1234;
  private static final int NOTIFICATION_PERMISSION_REQUEST_CODE = 1235;
  private static final int FULL_SCREEN_INTENT_PERMISSION_REQUEST_CODE = 1236;
  private static final String ALERT_PERMISSION_PREFS = "barangayresolve.alert.permissions";
  private static final String KEY_PERMISSION_FLOW_PROMPTED = "permission_flow_prompted";

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
    boolean prompted = getSharedPreferences(ALERT_PERMISSION_PREFS, MODE_PRIVATE)
        .getBoolean(KEY_PERMISSION_FLOW_PROMPTED, false);
    if (!prompted) {
      getSharedPreferences(ALERT_PERMISSION_PREFS, MODE_PRIVATE)
          .edit()
          .putBoolean(KEY_PERMISSION_FLOW_PROMPTED, true)
          .apply();
      requestAlertDisplayPermissions();
    }
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