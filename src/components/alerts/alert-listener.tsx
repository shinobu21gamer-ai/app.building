"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, CheckCheck, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/api-client";
import { enqueueAlerts, removeAlert, removeAlerts } from "@/lib/alert-queue";
import type { AlertView } from "@/components/alerts/alert-archive";
import { getPushMode, toNativeAlertView, type NativeAlertPayload } from "@/lib/capacitor-types";

/** Starts the one native alarm for the alert currently at the head of the queue. */
function startNativeAlarm(alert: AlertView) {
  const bridge = (window as Window & {
    AlertBridge?: {
      startAlertFor?: (id: number, title: string, message: string, severity: string, sound: boolean) => void;
    };
  }).AlertBridge;
  try {
    bridge?.startAlertFor?.(alert.id, alert.title, alert.message, alert.severity, alert.sound);
  } catch {
    // The web alert remains visible even if Android refuses to start the FGS.
  }
}

/** Tells the native layer (Capacitor) to silence one alert while keeping its notification. */
function silenceNativeAlarm(alertId: number) {
  const bridge = (
    window as Window & {
      AlertBridge?: { stopAlertSound?: () => void; stopAlertSoundFor?: (id: number) => void };
    }
  ).AlertBridge;
  if (!bridge) return;
  if (typeof bridge.stopAlertSoundFor === "function") {
    try {
      bridge.stopAlertSoundFor(alertId);
    } catch {
      /* fall through to the unconditional stop below */
    }
  }
  stopRingingAlarm(bridge);
}

/**
 * Stops whatever alarm is actually sounding on the device right now.
 *
 * The alert at the head of the web queue is not necessarily the one the
 * native foreground service is ringing: a background push can start ringing
 * a newer alert while an older unacknowledged alert still heads the queue
 * (the service keeps the first alert ringing, by design). Every native stop
 * is scoped to an alert id, so acknowledging the queued alert alone can
 * leave the other alert's sound playing. The user has confirmed/silenced
 * the dialog, so no alert sound may keep playing — stop the ringing alarm
 * too. No unacknowledged alert is lost: when the next queued alert becomes
 * the dialog head, its presentation effect raises its alarm again.
 */
function stopRingingAlarm(bridge?: { stopAlertSound?: () => void }) {
  const target =
    bridge ??
    (window as Window & { AlertBridge?: { stopAlertSound?: () => void } }).AlertBridge;
  if (!target || typeof target.stopAlertSound !== "function") return;
  try {
    target.stopAlertSound();
  } catch {
    /* not native */
  }
}

function stopNativeAlarm(alertId: number) {
  const bridge = (
    window as Window & {
      AlertBridge?: {
        stopAlertSound?: () => void;
        stopAlertSoundFor?: (id: number) => void;
        stopAlertFor?: (id: number) => void;
      };
    }
  ).AlertBridge;
  if (!bridge) return;
  if (typeof bridge.stopAlertFor === "function") {
    try {
      bridge.stopAlertFor(alertId);
    } catch {
      /* fall through to the unconditional stop below */
    }
  }
  stopRingingAlarm(bridge);
}

/**
 * Reads (and clears) an acknowledgement the native popup recorded before
 * dispatching `native-ack-requested`. Returns the alert id, or null when no
 * tap is pending or the APK predates the bridge method.
 */
function takePendingNativeAck(): number | null {
  const bridge = (
    window as Window & { AlertBridge?: { consumePendingAck?: () => number } }
  ).AlertBridge;
  if (!bridge || typeof bridge.consumePendingAck !== "function") return null;
  try {
    const id = bridge.consumePendingAck();
    return typeof id === "number" && id > 0 ? id : null;
  } catch {
    return null;
  }
}

export function AlertListener({ enabled = true }: { enabled?: boolean }) {
  const [pending, setPending] = useState<AlertView[]>([]);
  const [ackError, setAckError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const [muted, setMuted] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const shownIds = useRef(new Set<number>());
  const lastPresented = useRef<number | null>(null);

  const current = pending[0] ?? null;
  const queuedCount = pending.length;

  const focusDialog = useCallback(() => {
    dialogRef.current?.focus();
  }, []);

  // The web stays visual-only. Sound/vibration alarms are owned by the native
  // app so a browser open alongside the app cannot sound a second alarm.
  useEffect(() => {
    if (!current || lastPresented.current === current.id) return;
    lastPresented.current = current.id;
    shownIds.current.add(current.id);
    setMuted(false);
    setAckError(null);
    if (getPushMode() === "capacitor") startNativeAlarm(current);
    focusDialog();
  }, [current, focusDialog]);

  // Native push events and polling both feed the same queue.
  const offer = useCallback((incoming: AlertView[]) => {
    setPending((currentPending) => enqueueAlerts(currentPending, incoming, shownIds.current));
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      // Two producers dispatch this event with two different shapes: the
      // Capacitor path arrives already converted to AlertView (`id`), while
      // the Android foreground service (AlertMessagingService) evaluates its
      // raw FCM shape into the WebView (`alertId`/`message`). Normalise both
      // through toNativeAlertView — casting the raw shape to AlertView and
      // reading `.id` silently dropped every foreground push.
      const detail = (event as CustomEvent<NativeAlertPayload>).detail;
      const rawId = detail?.alertId ?? detail?.id;
      const parsedId = typeof rawId === "number" ? rawId : Number(rawId);
      if (!Number.isSafeInteger(parsedId) || parsedId <= 0) return;
      offer([toNativeAlertView(detail)]);
    };
    window.addEventListener("native-push-received", handler as EventListener);
    return () => window.removeEventListener("native-push-received", handler as EventListener);
  }, [offer]);

  // Native lock-screen popup ack ("OK, I understand" pressed while the app was not open).
  useEffect(() => {
    const acknowledgeFromNative = async (id: number) => {
      const result = await apiRequest(`/api/v1/alerts/${id}/acknowledge`, { method: "POST" });
      if (result.success || result.error.code === "NOT_FOUND") {
        stopNativeAlarm(id);
        setPending((currentPending) => removeAlert(currentPending, id));
        const isNative = getPushMode() === "capacitor";
        if (isNative) {
          const bridge = (window as Window & { AlertBridge?: { openAlertsPage?: () => void } }).AlertBridge;
          if (typeof bridge?.openAlertsPage === "function") {
            try {
              bridge.openAlertsPage();
            } catch {
              // ignore
            }
          }
        }
      } else {
        setAckError(result.error.message);
      }
    };
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: number }>).detail;
      const id = detail?.id;
      if (!id) return;
      // The popup records the tap natively as well (see below); this event
      // already carries it, so drop the record to avoid a duplicate ack.
      takePendingNativeAck();
      void acknowledgeFromNative(id);
    };
    window.addEventListener("native-ack-requested", handler as EventListener);
    // The popup's tap is a one-shot JS event: pressed before this page had
    // loaded (e.g. the app cold-started from the lock-screen popup), it is
    // gone by the time the listener registers. The bridge keeps the tap
    // pending until the web layer asks for it, so pick it up now. The ack
    // itself is an idempotent upsert, so a rare double delivery is harmless.
    const pendingId = takePendingNativeAck();
    if (pendingId !== null) void acknowledgeFromNative(pendingId);
    return () => window.removeEventListener("native-ack-requested", handler as EventListener);
  }, []);

  // Polling is for signed-in sessions only. The listener is mounted in the root
  // layout, so without this a signed-out visitor would poll an endpoint that can
  // only ever answer 401 — every 20 seconds, on every page.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    async function poll() {
      const result = await apiRequest<{ alerts: AlertView[] }>("/api/v1/alerts?active=true");
      if (cancelled || !result.success) return;
      offer(result.data.alerts);
    }
    void poll();
    const timer = window.setInterval(() => void poll(), 20000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [offer, enabled]);

  async function acknowledge() {
    if (!current || busy || batchBusy) return;
    setBusy(true);
    setAckError(null);
    // The user has confirmed the alert: stop the alarm sounding on the
    // device immediately instead of letting it blare for the whole server
    // round-trip (which can take seconds on a mobile connection, and read
    // as "OK didn't stop the sound"). Only the sound stops here — the
    // dialog stays until the server confirms, and the alert's notification
    // is cleared by stopNativeAlarm once it has. If the request fails, the
    // dialog remains with its error and the still-unacknowledged alert is
    // raised again the next time it is presented.
    silenceNativeAlarm(current.id);
    const result = await apiRequest(`/api/v1/alerts/${current.id}/acknowledge`, { method: "POST" });
    setBusy(false);
    if (!result.success && result.error.code !== "NOT_FOUND") {
      setAckError(result.error.message);
      return;
    }
    // The alert may have been removed by an administrator while this client
    // still had it queued. A 404 is then equivalent to a completed dismissal.
    stopNativeAlarm(current.id);
    const isNative = getPushMode() === "capacitor";
    if (isNative) {
      const bridge = (window as Window & { AlertBridge?: { openAlertsPage?: () => void } }).AlertBridge;
      if (typeof bridge?.openAlertsPage === "function") {
        try {
          bridge.openAlertsPage();
        } catch {
          // ignore
        }
      }
    }
    setPending((currentPending) => removeAlert(currentPending, current.id));
  }

  async function acknowledgeAndSkipAll() {
    const alertIds = pending.map((alert) => alert.id);
    if (alertIds.length < 2 || busy || batchBusy) return;

    setBatchBusy(true);
    setAckError(null);
    // Same contract as the single-alert confirm: the tap stops the alarm
    // sounding right away; the notifications clear once the server confirms.
    silenceNativeAlarm(alertIds[0]);
    const result = await apiRequest<{ acknowledged: boolean; count: number }>(
      "/api/v1/alerts/acknowledge-all",
      {
        method: "POST",
        body: JSON.stringify({ alertIds }),
      }
    );
    setBatchBusy(false);
    if (!result.success) {
      setAckError(result.error.message);
      return;
    }

    alertIds.forEach((id) => {
      shownIds.current.add(id);
      stopNativeAlarm(id);
    });
    const isNative = getPushMode() === "capacitor";
    if (isNative) {
      const bridge = (window as Window & { AlertBridge?: { openAlertsPage?: () => void } }).AlertBridge;
      if (typeof bridge?.openAlertsPage === "function") {
        try {
          bridge.openAlertsPage();
        } catch {
          // ignore
        }
      }
    }
    setPending((currentPending) => removeAlerts(currentPending, alertIds));
  }

  function silence() {
    if (current) silenceNativeAlarm(current.id);
    setMuted(true);
  }

  if (!current) return null;

  const critical = current.severity === "CRITICAL";
  const warning = current.severity === "WARNING";
  const border = critical ? "border-red-500" : warning ? "border-amber-400" : "border-brand-500";
  const severityStyle = critical
    ? "bg-red-100 text-red-800"
    : warning
      ? "bg-amber-100 text-amber-900"
      : "bg-brand-100 text-brand-900";
  const dot = critical ? "bg-red-600" : warning ? "bg-amber-500" : "bg-brand-600";
  const isBusy = busy || batchBusy;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-slate-950/70 p-4" role="alertdialog" aria-modal="true" aria-labelledby="system-alert-title">
      <div ref={dialogRef} tabIndex={-1} className={`w-full max-w-xl rounded-2xl border-2 bg-white p-6 shadow-2xl outline-none sm:p-7 ${border}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span className={`h-3.5 w-3.5 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
            <span className={`rounded-full px-2.5 py-1 text-xs font-extrabold uppercase tracking-wide ${severityStyle}`}>
              {current.severity} alert
            </span>
          </div>
          {queuedCount > 1 && (
            <p className="rounded-full bg-slate-100 px-3 py-1 text-sm font-bold text-slate-800" role="status" aria-live="polite">
              Alert 1 of {queuedCount}
            </p>
          )}
        </div>
        <h2 id="system-alert-title" className="mt-4 break-words text-2xl font-bold leading-tight text-slate-950">
          {current.title}
        </h2>
        <p className="mt-4 whitespace-pre-wrap break-words text-base leading-7 text-slate-800">
          {current.message}
        </p>

        {queuedCount > 1 && (
          <p className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium leading-6 text-slate-800">
            {queuedCount - 1} more alert{queuedCount - 1 === 1 ? "" : "s"} waiting. Acknowledge each one, or use the batch action below to record your acknowledgment for all of them.
          </p>
        )}

        {ackError ? (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800" role="alert">
            {ackError}
          </p>
        ) : null}

        <div className="mt-6 flex flex-col gap-2.5">
          <Button type="button" size="lg" onClick={acknowledge} disabled={isBusy}>
            <Check size={18} aria-hidden="true" />
            {busy ? "Confirming…" : "OK, I understand"}
          </Button>
          {queuedCount > 1 && (
            <Button
              type="button"
              variant="secondary"
              size="lg"
              onClick={acknowledgeAndSkipAll}
              disabled={isBusy}
              aria-label={`Acknowledge and skip all ${queuedCount} queued alerts`}
            >
              <CheckCheck size={18} aria-hidden="true" />
              {batchBusy ? "Acknowledging all…" : `Acknowledge & skip all ${queuedCount} alerts`}
            </Button>
          )}
          {getPushMode() === "capacitor" && !muted && (
            <Button type="button" variant="outline" onClick={silence} disabled={isBusy}>
              <VolumeX size={17} aria-hidden="true" />
              {current.sound ? "Silence alarm (do not acknowledge)" : "Silence vibration (do not acknowledge)"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
