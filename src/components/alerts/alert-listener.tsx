"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, CheckCheck, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/api-client";
import { enqueueAlerts, removeAlert, removeAlerts } from "@/lib/alert-queue";
import type { AlertView } from "@/components/alerts/alert-archive";
import { getPushMode } from "@/lib/capacitor-types";

interface AlarmSound {
  context: AudioContext;
  stop: () => void;
  resume: () => Promise<void>;
}

function audioContextClass(): typeof AudioContext | null {
  return (
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ||
    null
  );
}

/**
 * Every sound registers a teardown here the moment it is created and is
 * deregistered the moment it stops. This guarantees no alarm can outlive the
 * reference we hold on it, which is what previously left un-stoppable alarms
 * ringing over the top of each other.
 */
const liveAlarms = new Set<() => void>();

function silenceEveryAlarm() {
  for (const stop of Array.from(liveAlarms)) stop();
}

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
      return;
    } catch {
      /* fall through to the legacy no-arg method */
    }
  }
  try {
    bridge.stopAlertSound?.();
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
      return;
    } catch {
      /* fall through to the legacy no-arg method */
    }
  }
  if (typeof bridge.stopAlertSound === "function") {
    try {
      bridge.stopAlertSound();
    } catch {
      /* not native */
    }
  }
}

interface ToneOptions {
  frequency: number;
  type: OscillatorType;
  gain: number;
  duration: number | null;
  vibratoRate?: number;
  vibratoDepth?: number;
  tremoloRate?: number;
  tremoloDepth?: number;
}

function buildTone(context: AudioContext, options: ToneOptions): AlarmSound {
  const { frequency, type, gain: peak, duration, vibratoRate, vibratoDepth, tremoloRate, tremoloDepth } = options;
  const now = context.currentTime;

  const master = context.createGain();
  master.connect(context.destination);
  master.gain.setValueAtTime(0.0001, now);
  master.gain.exponentialRampToValueAtTime(peak, now + 0.02);

  const voice = context.createOscillator();
  voice.type = type;
  voice.frequency.setValueAtTime(frequency, now);
  voice.connect(master);
  voice.start(now);
  if (duration !== null) voice.stop(now + duration);

  const nodes: OscillatorNode[] = [voice];
  const gains: GainNode[] = [master];

  if (vibratoRate && vibratoDepth) {
    const lfo = context.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = vibratoRate;
    const lfoGain = context.createGain();
    lfoGain.gain.value = vibratoDepth;
    lfo.connect(lfoGain).connect(voice.frequency);
    lfo.start(now);
    nodes.push(lfo);
  }

  if (tremoloRate && tremoloDepth) {
    const amp = context.createOscillator();
    amp.type = "square";
    amp.frequency.value = tremoloRate;
    const ampGain = context.createGain();
    ampGain.gain.value = tremoloDepth;
    amp.connect(ampGain).connect(master.gain);
    amp.start(now);
    nodes.push(amp);
    gains.push(ampGain);
  }

  let closed = false;
  const stop = () => {
    if (closed) return;
    closed = true;
    liveAlarms.delete(stop);
    const t = context.currentTime;
    try {
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), t);
      master.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
      for (const node of nodes) node.stop(t + 0.1);
    } catch {
      // nodes may already be stopped; closing the context is enough
    }
    window.setTimeout(() => void context.close().catch(() => undefined), 200);
  };

  liveAlarms.add(stop);
  return {
    context,
    stop,
    resume: async () => {
      if (context.state === "suspended") await context.resume();
    },
  };
}

function createAlarmSound(severity: string): AlarmSound | null {
  const AudioContextClass = audioContextClass();
  if (!AudioContextClass) return null;
  try {
    const context = new AudioContextClass();
    switch (severity) {
      case "CRITICAL":
        return buildTone(context, {
          frequency: 960,
          type: "square",
          gain: 0.9,
          duration: null,
          vibratoRate: 0.5,
          vibratoDepth: 300,
          tremoloRate: 2.5,
          tremoloDepth: 0.35,
        });
      case "WARNING":
        return buildTone(context, {
          frequency: 800,
          type: "square",
          gain: 0.7,
          duration: null,
          vibratoRate: 1.5,
          vibratoDepth: 120,
        });
      default:
        return buildTone(context, { frequency: 880, type: "sine", gain: 0.4, duration: 0.5 });
    }
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

  // Whenever the head of the queue changes, tear the previous alarm down before
  // starting the next one. Without this the sounds stack up and the user loses
  // the handle needed to silence them.
  useEffect(() => {
    if (!current || lastPresented.current === current.id) return;
    lastPresented.current = current.id;
    shownIds.current.add(current.id);
    silenceEveryAlarm();
    setMuted(false);
    setAckError(null);
    const isNative = getPushMode() === "capacitor";
    if (isNative) {
      startNativeAlarm(current);
    } else if (current.sound) {
      createAlarmSound(current.severity)?.resume().catch(() => undefined);
    }
    focusDialog();
  }, [current, focusDialog]);

  // Native push events and polling both feed the same queue.
  const offer = useCallback((incoming: AlertView[]) => {
    setPending((currentPending) => enqueueAlerts(currentPending, incoming, shownIds.current));
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const nativeAlert = (event as CustomEvent<AlertView>).detail;
      if (nativeAlert?.id) offer([nativeAlert]);
    };
    window.addEventListener("native-push-received", handler as EventListener);
    return () => window.removeEventListener("native-push-received", handler as EventListener);
  }, [offer]);

  // Native lock-screen popup ack ("OK, I understand" pressed while the app was not open).
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: number }>).detail;
      const id = detail?.id;
      if (!id) return;
      void (async () => {
        silenceEveryAlarm();
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
      })();
    };
    window.addEventListener("native-ack-requested", handler as EventListener);
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
      silenceEveryAlarm();
    };
  }, [offer, enabled]);

  async function acknowledge() {
    if (!current || busy || batchBusy) return;
    setBusy(true);
    setAckError(null);
    const result = await apiRequest(`/api/v1/alerts/${current.id}/acknowledge`, { method: "POST" });
    setBusy(false);
    if (!result.success && result.error.code !== "NOT_FOUND") {
      setAckError(result.error.message);
      return;
    }
    // The alert may have been removed by an administrator while this client
    // still had it queued. A 404 is then equivalent to a completed dismissal.
    silenceEveryAlarm();
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
    silenceEveryAlarm();
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
    silenceEveryAlarm();
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
          {(current.sound || getPushMode() === "capacitor") && !muted && (
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
