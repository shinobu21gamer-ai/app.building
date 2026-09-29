"use client";

import { useState } from "react";
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

export function AlertArchive({ initialAlerts }: { initialAlerts: AlertView[] }) {
  const [alerts, setAlerts] = useState(initialAlerts);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function react(alertId: number, reaction: string) {
    setBusy(alertId);
    setError(null);
    const result = await apiRequest<{ reaction: string }>(`/api/v1/alerts/${alertId}/react`, {
      method: "POST",
      body: JSON.stringify({ reaction }),
    });
    setBusy(null);
    if (!result.success) {
      setError(result.error.message);
      return;
    }
    setAlerts((current) => current.map((alert) => ({
      ...alert,
      reactions: { ...alert.reactions, [reaction]: (alert.reactions[reaction] ?? 0) + 1 },
    })));
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
      {alerts.length === 0 && <p className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">No alerts yet.</p>}
      {alerts.map((alert) => (
        <article key={alert.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <span className="text-xs font-bold uppercase tracking-wide text-amber-700">{alert.severity}</span>
              <h2 className="mt-1 text-lg font-semibold text-slate-900">{alert.title}</h2>
            </div>
            <time className="text-xs text-slate-500">{formatDateTime(alert.createdAt)}</time>
          </div>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{alert.message}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {(["ACKNOWLEDGED", "HELPFUL", "NEED_HELP"] as const).map((reaction) => (
              <Button key={reaction} size="sm" variant="outline" disabled={busy === alert.id} onClick={() => react(alert.id, reaction)}>
                {reaction.replace("_", " ")} ({alert.reactions[reaction] ?? 0})
              </Button>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}
