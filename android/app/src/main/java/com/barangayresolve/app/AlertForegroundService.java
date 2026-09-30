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
 * Native alarm host. Started by {@link AlertMessagingService} whenever a push arrives
 * while the app is not in the foreground. Owns the whole native alert experience:
 * <ul>
 *   <li>looping severity sound on the alarm stream,</li>
 *   <li>repeating severity vibration,</li>
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

  private static final String CHANNEL_ID = NotificationChannels.SERVICE_CHANNEL_ID;
  private static final int NOTIFICATION_ID = 1001;
  private static final String TAG = "AlertForegroundService";

  private static volatile boolean sRunning = false;

  public static boolean isRunning() {
    return sRunning;
  }

  private MediaPlayer mediaPlayer;
  private Vibrator vibrator;
  private PowerManager.WakeLock wakeLock;
  private WindowManager windowManager;
  private View overlayView;
  private int currentAlertId = -1;
  private String currentSeverity = "INFO";
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
    startForeground(NOTIFICATION_ID, buildNotification(intent));

    if (ACTION_START_ALERT.equals(action) && intent != null) {
      startAlarm(intent);
    } else if (ACTION_STOP_ALERT.equals(action)) {
      endAlarm();
    } else {
      // START_STICKY: if the system kills the service (app swiped away), restart
      // it so the alarm keeps ringing. Re-deliver the last intent if we have one.
      if (intent != null) {
        startAlarm(intent);
      }
    }
    return START_STICKY;
  }

  private void registerStopReceiver() {
    stopReceiver =
        new BroadcastReceiver() {
          @Override
          public void onReceive(Context context, Intent intent) {
            endAlarm();
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

  private void startAlarm(Intent intent) {
    stopAlarm();

    String title = intent.getStringExtra(EXTRA_TITLE);
    String body = intent.getStringExtra(EXTRA_BODY);
    String severity = intent.getStringExtra(EXTRA_SEVERITY);
    currentAlertId = intent.getIntExtra(EXTRA_ALERT_ID, -1);
    currentSeverity = severity != null ? severity : "INFO";
    String safeTitle = title != null ? title : "BarangayResolve Alert";

    // Persist so the alarm can be restarted if the app process is killed.
    if (currentAlertId != -1) {
      AlertRestartReceiver.saveActiveAlert(this, currentAlertId, safeTitle, body != null ? body : "", currentSeverity);
    }

    playAlertSound(currentSeverity);
    startVibration(currentSeverity);
    acquireWakeLock();
    showOverlay(safeTitle, body != null ? body : "", currentSeverity, currentAlertId);
  }

  private void playAlertSound(String severity) {
    try {
      if (mediaPlayer != null) {
        mediaPlayer.release();
        mediaPlayer = null;
      }
      mediaPlayer = MediaPlayer.create(this, NotificationChannels.rawSound(severity));
      if (mediaPlayer != null) {
        mediaPlayer.setLooping(true);
        mediaPlayer.setAudioAttributes(
            new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build());
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
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
      } else {
        vibrator.vibrate(pattern, 0);
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
      int flags =
          WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
              | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
              | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
              | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD;
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
      LocalBroadcastManager.getInstance(context).sendBroadcast(new Intent(ACTION_STOP_ALERT));
    }
    if (cancelNotification) {
      try {
        NotificationManagerCompat.from(context).cancel("barangayalert", alertId);
      } catch (Exception ignored) {
      }
    }
  }
}