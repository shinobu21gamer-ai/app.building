package com.barangayresolve.app;

import android.content.Context;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/** Programmatic alert card shared by the lock-screen activity and the overlay window. */
public final class AlertUi {

  private AlertUi() {}

  public static View build(
      Context context,
      String severity,
      String title,
      String message,
      Runnable onAcknowledge,
      Runnable onSilence) {
    int accent = NotificationChannels.severityColor(severity);
    String label = severity + " alert";

    FrameLayout root = new FrameLayout(context);
    // Dim behind a compact, centered message card rather than covering the
    // display with an almost-opaque full-screen panel.
    root.setBackgroundColor(0x990B1220);
    root.setClickable(true);
    root.setFocusable(true);

    LinearLayout card = new LinearLayout(context);
    card.setOrientation(LinearLayout.VERTICAL);
    card.setPadding(dp(context, 24), dp(context, 22), dp(context, 24), dp(context, 20));
    GradientDrawable cardBg = new GradientDrawable();
    cardBg.setColor(Color.WHITE);
    cardBg.setCornerRadius(dp(context, 22));
    cardBg.setStroke(dp(context, 2), accent);
    card.setBackground(cardBg);
    card.setElevation(dp(context, 20));

    // Header: severity dot + label.
    LinearLayout header = new LinearLayout(context);
    header.setOrientation(LinearLayout.HORIZONTAL);
    header.setGravity(Gravity.CENTER_VERTICAL);

    View dot = new View(context);
    GradientDrawable dotBg = new GradientDrawable();
    dotBg.setShape(GradientDrawable.OVAL);
    dotBg.setColor(accent);
    dot.setBackground(dotBg);
    header.addView(dot, dp(context, 12), dp(context, 12));

    TextView severityLabel = new TextView(context);
    severityLabel.setText(label.toUpperCase(java.util.Locale.US));
    severityLabel.setTextColor(0xFF64748B);
    severityLabel.setTextSize(12);
    severityLabel.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
    severityLabel.setLetterSpacing(0.08f);
    LinearLayout.LayoutParams labelLp =
        new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
    labelLp.gravity = Gravity.CENTER_VERTICAL;
    labelLp.setMargins(dp(context, 8), 0, 0, 0);
    header.addView(severityLabel, labelLp);
    card.addView(header);

    TextView titleView = new TextView(context);
    titleView.setText(title);
    titleView.setTextColor(0xFF0F172A);
    titleView.setTextSize(20);
    titleView.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
    titleView.setMaxLines(4);
    titleView.setEllipsize(android.text.TextUtils.TruncateAt.END);
    card.addView(titleView, new LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
    ((LinearLayout.LayoutParams) titleView.getLayoutParams()).setMargins(0, dp(context, 12), 0, 0);

    // Scrollable message body so long alerts never overflow the screen.
    TextView messageView = new TextView(context);
    messageView.setText(message);
    messageView.setTextColor(0xFF334155);
    messageView.setTextSize(14);
    messageView.setLineSpacing(0f, 1.15f);
    ScrollView scroll = new ScrollView(context);
    scroll.setFillViewport(false);
    scroll.addView(messageView, new ScrollView.LayoutParams(
        ScrollView.LayoutParams.MATCH_PARENT, ScrollView.LayoutParams.WRAP_CONTENT));
    card.addView(scroll, new LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT, dp(context, 180)));
    ((LinearLayout.LayoutParams) scroll.getLayoutParams()).setMargins(0, dp(context, 10), 0, dp(context, 18));

    // Actions: Silence + OK, I understand.
    LinearLayout buttons = new LinearLayout(context);
    buttons.setOrientation(LinearLayout.HORIZONTAL);
    buttons.setWeightSum(2f);

    Button silence = styledButton(context, accent, 0x00FFFFFF, accent, "Silence");
    silence.setOnClickListener(
        v -> {
          if (onSilence != null) onSilence.run();
        });
    buttons.addView(silence, new LinearLayout.LayoutParams(0, dp(context, 52), 1f));

    Button acknowledge = styledButton(context, accent, accent, Color.WHITE, "OK, I understand");
    acknowledge.setOnClickListener(
        v -> {
          if (onAcknowledge != null) onAcknowledge.run();
        });
    LinearLayout.LayoutParams ackLp = new LinearLayout.LayoutParams(0, dp(context, 52), 1f);
    ackLp.setMargins(dp(context, 12), 0, 0, 0);
    buttons.addView(acknowledge, ackLp);
    card.addView(buttons);

    int maxCardWidth = dp(context, 440);
    int screenWidth = context.getResources().getDisplayMetrics().widthPixels;
    int sideMargin = dp(context, 24);
    int cardWidth = Math.min(maxCardWidth, screenWidth - (sideMargin * 2));
    FrameLayout.LayoutParams cardParams =
        new FrameLayout.LayoutParams(cardWidth, FrameLayout.LayoutParams.WRAP_CONTENT);
    cardParams.gravity = Gravity.CENTER;
    cardParams.setMargins(sideMargin, dp(context, 16), sideMargin, dp(context, 16));
    root.addView(card, cardParams);

    return root;
  }

  private static Button styledButton(Context context, int accent, int fill, int textColor, String text) {
    Button button = new Button(context);
    button.setText(text);
    button.setTextSize(15);
    button.setAllCaps(false);
    button.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
    button.setTextColor(textColor);
    GradientDrawable bg = new GradientDrawable();
    bg.setColor(fill);
    bg.setCornerRadius(dp(context, 14));
    if (fill == 0x00FFFFFF) bg.setStroke(dp(context, 2), accent);
    button.setBackground(bg);
    return button;
  }

  private static int dp(Context context, float value) {
    return (int) (value * context.getResources().getDisplayMetrics().density + 0.5f);
  }
}