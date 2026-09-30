package com.barangayresolve.app;

import android.app.Activity;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;

/**
 * Lock-screen popup launched through the notification's full-screen intent. Shows the
 * same alert card as the overlay but as an activity, which is the only sanctioned way
 * to take over (or appear over) the keyguard.
 */
public class FullScreenAlertActivity extends Activity {

  public static final String EXTRA_ALERT_ID = "alert_id";
  public static final String EXTRA_TITLE = "alert_title";
  public static final String EXTRA_BODY = "alert_body";
  public static final String EXTRA_SEVERITY = "severity";

  private int alertId;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    getWindow().addFlags(
        WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
            | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            | WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
            | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true);
      setTurnScreenOn(true);
    }

    bindAlert(getIntent());
  }

  @Override
  protected void onNewIntent(android.content.Intent intent) {
    super.onNewIntent(intent);
    bindAlert(intent);
  }

  private void bindAlert(android.content.Intent intent) {
    alertId = intent.getIntExtra(EXTRA_ALERT_ID, -1);
    String title = intent.getStringExtra(EXTRA_TITLE);
    String body = intent.getStringExtra(EXTRA_BODY);
    String severity = intent.getStringExtra(EXTRA_SEVERITY);
    if (title == null) title = "BarangayResolve Alert";
    if (severity == null) severity = "INFO";

    setContentView(
        AlertUi.build(
            this,
            severity,
            title,
            body != null ? body : "",
            () -> {
              AlertActions.acknowledge(this, alertId);
              finish();
            },
            () -> {
              AlertActions.silence(this, alertId);
              finish();
            }));
  }
}