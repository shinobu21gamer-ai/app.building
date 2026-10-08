"use client";

import { useState } from "react";
import { Check, LifeBuoy, ThumbsUp } from "lucide-react";
import { apiRequest } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";

export type AlertView = {
  id: number;
  title: string;
  message: string;
  severity: string;
  sound: boolean;
  createdAt: string;
  expiresAt: string | null;
  acknowledged: boolean;
  reactions: Record<string, number>;
};

const REACTIONS = [
  { value: "ACKNOWLEDGED", label: "Acknowledge", Icon: Check },
  { value: "HELPFUL", label: "Helpful", Icon: ThumbsUp },
  { value: "NEED_HELP", label: "Need help", Icon: LifeBuoy },
] as const;

function severityStyle(severity: string): string {
  if (severity === "CRITICAL") return "bg-red-100 text-red-800";
  if (severity === "WARNING") return "bg-amber-100 text-amber-900";
  return "bg-brand-100 text-brand-900";
}

export function AlertArchive({ initialAlerts }: { initialAlerts: AlertView[] }) {
  const [alerts, setAlerts] = useState(initialAlerts);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function react(alertId: number, reaction: string) {
    setBusy(alertId);
    setError(null);
    const result = await apiRequest<{ reaction: string; counts: Record<string, number> }>(
      `/api/v1/alerts/${alertId}/react`,
      {
        method: "POST",
        body: JSON.stringify({ reaction }),
      }
    );
    setBusy(null);
    if (!result.success) {
      setError(result.error.message);
      return;
    }
    // Replace with the server's authoritative tally (one vote per user, so
    // switching a reaction must decrease the previous one).
    setAlerts((current) => current.map((alert) =>
      alert.id === alertId ? { ...alert, reactions: result.data.counts } : alert
    ));
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800" role="alert">
          {error}
        </p>
      )}
      {alerts.length === 0 && (
        <p className="rounded-xl border border-slate-200 bg-white p-8 text-center text-base text-slate-700">
          No alerts yet.
        </p>
      )}
      {alerts.map((alert) => (
        <article key={alert.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-extrabold uppercase tracking-wide ${severityStyle(alert.severity)}`}>
                {alert.severity}
              </span>
              <h2 className="mt-2 break-words text-lg font-bold text-slate-950">{alert.title}</h2>
            </div>
            <time className="shrink-0 text-sm font-medium text-slate-600">{formatDateTime(alert.createdAt)}</time>
          </div>
          <p className="mt-4 whitespace-pre-wrap break-words text-base leading-7 text-slate-800">
            {alert.message}
          </p>
          <div className="mt-5 flex flex-wrap gap-2" aria-label={`Reactions for ${alert.title}`}>
            {REACTIONS.map(({ value, label, Icon }) => (
              <Button
                key={value}
                size="sm"
                variant="outline"
                disabled={busy === alert.id}
                onClick={() => react(alert.id, value)}
              >
                <Icon size={15} aria-hidden="true" />
                {label} ({alert.reactions[value] ?? 0})
              </Button>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}
