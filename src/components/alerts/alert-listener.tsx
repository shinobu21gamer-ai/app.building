"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/api-client";
import { enqueueAlerts, removeAlert } from "@/lib/alert-queue";
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

/** Tells the native layer (Capacitor) to stop the ringing alarm for a specific alert. */
function stopNativeAlarm(alertId: number) {
  const bridge = (
    window as Window & {
      AlertBridge?: { stopAlertSound?: () => void; stopAlertFor?: (id: number) => void };
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

export function AlertListener() {
  const [pending, setPending] = useState<AlertView[]>([]);
  const [ackError, setAckError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
    if (!isNative && current.sound) createAlarmSound(current.severity)?.resume().catch(() => undefined);
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
        if (result.success) setPending((currentPending) => removeAlert(currentPending, id));
      })();
    };
    window.addEventListener("native-ack-requested", handler as EventListener);
    return () => window.removeEventListener("native-ack-requested", handler as EventListener);
  }, []);

  useEffect(() => {
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
  }, [offer]);

  async function acknowledge() {
    if (!current) return;
    setBusy(true);
    setAckError(null);
    const result = await apiRequest(`/api/v1/alerts/${current.id}/acknowledge`, { method: "POST" });
    setBusy(false);
    if (!result.success) {
      setAckError(result.error.message);
      return;
    }
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

  function silence() {
    silenceEveryAlarm();
    if (current) stopNativeAlarm(current.id);
    setMuted(true);
  }

  if (!current) return null;

  const critical = current.severity === "CRITICAL";
  const border = critical ? "border-red-500" : current.severity === "WARNING" ? "border-amber-400" : "border-brand-500";
  const dot = critical ? "bg-red-600" : current.severity === "WARNING" ? "bg-amber-500" : "bg-brand-600";

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-slate-950/60 p-4" role="alertdialog" aria-modal="true" aria-labelledby="system-alert-title">
      <div ref={dialogRef} tabIndex={-1} className={`w-full max-w-lg rounded-2xl border-2 bg-white p-6 shadow-2xl outline-none ${border}`}>
        <div className="flex items-center gap-2">
          <span className={`h-3 w-3 rounded-full ${dot}`} aria-hidden />
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{current.severity} alert</p>
        </div>
        <h2 id="system-alert-title" className="mt-3 text-xl font-bold text-slate-900">{current.title}</h2>
        <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{current.message}</p>

        {queuedCount > 1 && (
          <p className="mt-4 rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">
            {queuedCount - 1} more alert{queuedCount - 1 === 1 ? "" : "s"} waiting
          </p>
        )}

        {ackError ? (
          <p className="mt-3 text-sm text-red-600" role="alert">{ackError}</p>
        ) : null}

        <div className="mt-6 flex flex-col gap-2">
          <Button type="button" onClick={acknowledge} disabled={busy}>
            {busy ? "Confirming..." : "OK, I understand"}
          </Button>
          {current.sound && !muted && (
            <Button type="button" variant="outline" onClick={silence}>
              Silence alarm (do not acknowledge)
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
