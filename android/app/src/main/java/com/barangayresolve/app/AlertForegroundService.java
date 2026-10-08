package com.barangayresolve.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.PixelFormat;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.provider.Settings;
import android.util.Log;
import android.view.View;
import android.view.WindowManager;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.localbroadcastmanager.content.LocalBroadcastManager;

/**
 * Native alarm host. Started by {@link AlertMessagingService} for background pushes
 * and by the WebView queue bridge for the active alert. Owns the native experience:
 * <ul>
 *   <li>a severity sound (one-shot for INFO, looping for WARNING/CRITICAL),</li>
 *   <li>a severity-pattern vibration (repeating for warnings and critical alerts),</li>
 *   <li>a {@link WindowManager} overlay popup (when SYSTEM_ALERT_WINDOW is granted),</li>
 *   <li>a wakelock so the alarm cannot be interrupted mid-play.</li>
 * </ul>
 * Everything stops on the {@link #ACTION_STOP_ALERT} broadcast (raised by the popup
 * buttons or the web layer's acknowledge/silence actions).
 */
public class AlertForegroundService extends Service {

  public static final String ACTION_START_ALERT = "com.barangayresolve.app.START_ALERT";
  public static final String ACTION_STOP_ALERT = "com.barangayresolve.app.STOP_ALERT";

  public static final String EXTRA_TITLE = "alert_title";
  public static final String EXTRA_BODY = "alert_body";
  public static final String EXTRA_SEVERITY = "severity";
  public static final String EXTRA_ALERT_ID = "alert_id";
  public static final String EXTRA_SOUND = "sound";
  public static final String EXTRA_SHOW_OVERLAY = "show_overlay";

  private static final String CHANNEL_ID = NotificationChannels.SERVICE_CHANNEL_ID;
  private static final int NOTIFICATION_ID = 1001;
  private static final String TAG = "AlertForegroundService";

  private static volatile boolean sRunning = false;
  private static volatile int sCurrentAlertId = -1;

  public static boolean isRunning() {
    return sRunning;
  }

  public static boolean hasActiveAlert() {
    return sRunning && sCurrentAlertId != -1;
  }

  private MediaPlayer mediaPlayer;
  private Vibrator vibrator;
  private PowerManager.WakeLock wakeLock;
  private WindowManager windowManager;
  private View overlayView;
  private int currentAlertId = -1;
  private String currentTitle = "BarangayResolve Alert";
  private String currentBody = "";
  private String currentSeverity = "INFO";
  private boolean currentSound = true;
  private BroadcastReceiver stopReceiver;

  @Override
  public void onCreate() {
    super.onCreate();
    NotificationChannels.ensure(this);
    registerStopReceiver();
    sRunning = true;
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    String action = intent == null ? null : intent.getAction();
    Intent alertIntent = intent;
    boolean shouldStartAlarm = false;

    // Defence in depth. AlertMessagingService already gates delivery on the
    // session; this catches the paths that bypass it — a sticky restart with a
    // null intent, a reboot restore, or a stale broadcast. A stop request is
    // always honoured so a signed-out device can still be silenced.
    if (!ACTION_STOP_ALERT.equals(action) && !SessionState.deliveryAllowed(this)) {
      Log.i(TAG, "Ignoring alert start: no signed-in session on this device.");
      AlertRestartReceiver.clearActiveAlert(this);
      stopForeground(true);
      stopSelf();
      return START_NOT_STICKY;
    }

    if (intent == null) {
      // START_STICKY restarts a killed service with a null intent. Rebuild the
      // last alert from durable state instead of leaving a silent FGS behind.
      alertIntent = AlertRestartReceiver.restoreActiveAlertIntent(this);
      shouldStartAlarm = alertIntent != null;
    } else if (ACTION_START_ALERT.equals(action)) {
      if (currentAlertId != -1) {
        // Keep the alert already ringing. Every later alert has its own system
        // notification and will be queued by the web alert feed when opened.
        alertIntent = currentAlertIntent();
      } else {
        Intent savedAlert = AlertRestartReceiver.restoreActiveAlertIntent(this);
        int incomingId = intent.getIntExtra(EXTRA_ALERT_ID, -1);
        int savedId = savedAlert == null ? -1 : savedAlert.getIntExtra(EXTRA_ALERT_ID, -1);
        if (savedAlert != null && savedId != incomingId) {
          // If Android reclaimed the service, resume the saved alert before a
          // newer FCM message can replace it.
          alertIntent = savedAlert;
        }
        shouldStartAlarm = alertIntent != null;
      }
    }

    startForeground(NOTIFICATION_ID, buildNotification(alertIntent));

    if (ACTION_STOP_ALERT.equals(action) && intent != null) {
      int requestedId = intent.getIntExtra(EXTRA_ALERT_ID, -1);
      if (requestedId == -1 || requestedId == currentAlertId) endAlarm();
    } else if (shouldStartAlarm && alertIntent != null) {
      startAlarm(alertIntent);
    } else if (alertIntent == null) {
      stopForeground(true);
      stopSelf(startId);
      return START_NOT_STICKY;
    }
    return START_STICKY;
  }

  private void registerStopReceiver() {
    stopReceiver =
        new BroadcastReceiver() {
          @Override
          public void onReceive(Context context, Intent intent) {
            int requestedId = intent.getIntExtra(EXTRA_ALERT_ID, -1);
            if (requestedId == -1 || requestedId == currentAlertId) endAlarm();
          }
        };
    IntentFilter filter = new IntentFilter(ACTION_STOP_ALERT);
    LocalBroadcastManager.getInstance(this).registerReceiver(stopReceiver, filter);
  }

  private void unregisterStopReceiver() {
    if (stopReceiver != null) {
      LocalBroadcastManager.getInstance(this).unregisterReceiver(stopReceiver);
      stopReceiver = null;
    }
  }

  private Intent currentAlertIntent() {
    Intent current = new Intent(this, AlertForegroundService.class);
    current.setAction(ACTION_START_ALERT);
    current.putExtra(EXTRA_ALERT_ID, currentAlertId);
    current.putExtra(EXTRA_TITLE, currentTitle);
    current.putExtra(EXTRA_BODY, currentBody);
    current.putExtra(EXTRA_SEVERITY, currentSeverity);
    current.putExtra(EXTRA_SOUND, currentSound);
    current.putExtra(EXTRA_SHOW_OVERLAY, false);
    return current;
  }

  private void startAlarm(Intent intent) {
    stopAlarm();

    String title = intent.getStringExtra(EXTRA_TITLE);
    String body = intent.getStringExtra(EXTRA_BODY);
    String severity = intent.getStringExtra(EXTRA_SEVERITY);
    currentAlertId = intent.getIntExtra(EXTRA_ALERT_ID, -1);
    currentSeverity = severity != null ? severity : "INFO";
    String safeTitle = title != null ? title : "BarangayResolve Alert";
    currentTitle = safeTitle;
    currentBody = body != null ? body : "";
    currentSound = intent.getBooleanExtra(EXTRA_SOUND, true);
    sCurrentAlertId = currentAlertId;
    boolean sound = currentSound;
    boolean showOverlay = intent.getBooleanExtra(EXTRA_SHOW_OVERLAY, true);

    // Persist so the alarm can be restarted if the Android process is reclaimed.
    if (currentAlertId != -1) {
      AlertRestartReceiver.saveActiveAlert(
          this,
          currentAlertId,
          safeTitle,
          body != null ? body : "",
          currentSeverity,
          sound,
          showOverlay);
    }

    if (sound) playAlertSound(currentSeverity);
    startVibration(currentSeverity);
    acquireWakeLock();
    if (showOverlay && isInteractiveAndUnlocked()) {
      showOverlay(safeTitle, body != null ? body : "", currentSeverity, currentAlertId);
    }
  }

  private void playAlertSound(String severity) {
    try {
      if (mediaPlayer != null) {
        mediaPlayer.release();
        mediaPlayer = null;
      }
      AudioAttributes alarmAttributes =
          new AudioAttributes.Builder()
              .setUsage(AudioAttributes.USAGE_ALARM)
              .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
              .build();
      mediaPlayer =
          MediaPlayer.create(
              this,
              NotificationChannels.rawSound(severity),
              alarmAttributes,
              AudioManager.AUDIO_SESSION_ID_GENERATE);
      if (mediaPlayer != null) {
        mediaPlayer.setLooping(!"INFO".equalsIgnoreCase(severity));
        mediaPlayer.start();
      }
    } catch (Exception e) {
      Log.e(TAG, "Error playing alert sound", e);
    }
  }

  private void startVibration(String severity) {
    long[] pattern = NotificationChannels.vibrationPattern(severity);
    try {
      Vibrator vibrator = getVibrator();
      if (vibrator == null || !vibrator.hasVibrator()) return;
      int repeatIndex = "INFO".equalsIgnoreCase(severity) ? -1 : 0;
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        vibrator.vibrate(VibrationEffect.createWaveform(pattern, repeatIndex));
      } else {
        vibrator.vibrate(pattern, repeatIndex);
      }
    } catch (Exception e) {
      Log.e(TAG, "Could not start vibration", e);
    }
  }

  private Vibrator getVibrator() {
    if (vibrator != null) return vibrator;
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        VibratorManager vm = getSystemService(VibratorManager.class);
        vibrator = vm != null ? vm.getDefaultVibrator() : null;
      } else {
        vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
      }
    } catch (Exception e) {
      vibrator = null;
    }
    return vibrator;
  }

  private void acquireWakeLock() {
    try {
      PowerManager pm = getSystemService(PowerManager.class);
      if (pm == null) return;
      wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "BarangayResolve:alert");
      wakeLock.setReferenceCounted(false);
      wakeLock.acquire(10 * 60 * 1000L);
    } catch (Exception e) {
      Log.e(TAG, "Could not acquire wake lock", e);
    }
  }

  private void releaseWakeLock() {
    if (wakeLock != null && wakeLock.isHeld()) {
      try {
        wakeLock.release();
      } catch (Exception ignored) {
      }
      wakeLock = null;
    }
  }

  private boolean isInteractiveAndUnlocked() {
    PowerManager powerManager = getSystemService(PowerManager.class);
    if (powerManager == null || !powerManager.isInteractive()) return false;
    android.app.KeyguardManager keyguardManager = getSystemService(android.app.KeyguardManager.class);
    return keyguardManager == null || !keyguardManager.isKeyguardLocked();
  }

  private void showOverlay(String title, String body, String severity, int alertId) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this)) {
      return;
    }
    try {
      windowManager = getSystemService(WindowManager.class);
      int type =
          Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
              ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
              : WindowManager.LayoutParams.TYPE_PHONE;
      // This is only used on an interactive, unlocked screen. The lock-screen
      // path is handled by FullScreenAlertActivity via a full-screen notification.
      int flags = WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON;
      WindowManager.LayoutParams params =
          new WindowManager.LayoutParams(
              WindowManager.LayoutParams.MATCH_PARENT,
              WindowManager.LayoutParams.MATCH_PARENT,
              type,
              flags,
              PixelFormat.TRANSLUCENT);
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        params.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
      }

      overlayView =
          AlertUi.build(
              this,
              severity,
              title,
              body,
              () -> AlertActions.acknowledge(this, alertId),
              () -> AlertActions.silence(this, alertId));
      windowManager.addView(overlayView, params);
    } catch (Exception e) {
      Log.e(TAG, "Could not show overlay", e);
    }
  }

  private void removeOverlay() {
    if (overlayView != null) {
      try {
        if (windowManager != null) windowManager.removeView(overlayView);
      } catch (Exception ignored) {
      }
      overlayView = null;
      windowManager = null;
    }
  }

  private void stopAlarm() {
    if (mediaPlayer != null) {
      try {
        if (mediaPlayer.isPlaying()) mediaPlayer.stop();
        mediaPlayer.release();
      } catch (Exception ignored) {
      }
      mediaPlayer = null;
    }
    if (vibrator != null) {
      try {
        vibrator.cancel();
      } catch (Exception ignored) {
      }
      vibrator = null;
    }
    releaseWakeLock();
    removeOverlay();
  }

  /** Full stop: silence and take the foreground service down with it. */
  private void endAlarm() {
    stopAlarm();
    AlertRestartReceiver.clearActiveAlert(this);
    currentAlertId = -1;
    currentTitle = "BarangayResolve Alert";
    currentBody = "";
    currentSound = true;
    sCurrentAlertId = -1;
    stopForeground(true);
    stopSelf();
  }

  private Notification buildNotification(@Nullable Intent intent) {
    String title = "BarangayResolve is monitoring alerts";
    String body = "Emergency alerts will appear here instantly.";
    int color = 0xFF2482CC;
    if (intent != null) {
      String severity = intent.getStringExtra(EXTRA_SEVERITY);
      if (intent.hasExtra(EXTRA_TITLE)) {
        title = intent.getStringExtra(EXTRA_TITLE);
        body = intent.getStringExtra(EXTRA_BODY);
      }
      color = NotificationChannels.severityColor(severity);
    }

    Intent open = new Intent(this, MainActivity.class);
    open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    PendingIntent content =
        PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

    return new NotificationCompat.Builder(this, CHANNEL_ID)
        .setContentTitle(title)
        .setContentText(body)
        .setSmallIcon(android.R.drawable.ic_dialog_alert)
        .setColor(color)
        .setPriority(NotificationCompat.PRIORITY_HIGH)
        .setCategory(NotificationCompat.CATEGORY_SERVICE)
        .setContentIntent(content)
        .setOngoing(true)
        .build();
  }

  @Override
  public void onDestroy() {
    super.onDestroy();
    stopAlarm();
    unregisterStopReceiver();
    sRunning = false;
  }

  @Nullable
  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }

  /** Stops the alarm and, when acknowledged, also clears the alert notification. */
  public static void stop(Context context, int alertId, boolean cancelNotification) {
    if (sRunning) {
      Intent stop = new Intent(ACTION_STOP_ALERT);
      stop.putExtra(EXTRA_ALERT_ID, alertId);
      LocalBroadcastManager.getInstance(context).sendBroadcast(stop);
    } else if (
        alertId == -1 || AlertRestartReceiver.getActiveAlertId(context) == alertId) {
      // The service may have been reclaimed before the web UI acknowledges it.
      // Clear durable state too, or a reboot would revive an already-acknowledged alert.
      AlertRestartReceiver.clearActiveAlert(context);
      sCurrentAlertId = -1;
    }
    if (cancelNotification && alertId >= 0) {
      try {
        NotificationManagerCompat.from(context).cancel("barangayalert", alertId);
      } catch (Exception ignored) {
      }
    }
  }
}