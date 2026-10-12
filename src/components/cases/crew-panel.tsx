"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormMessage, Input, Label, Textarea } from "@/components/ui/field";
import { apiRequest } from "@/lib/api-client";
import { copy, type Locale } from "@/lib/i18n";

type CrewAssignmentView = {
  id: number;
  crewId: number;
  name: string;
  trade: string | null;
  isActive: boolean;
  releaseReason: string | null;
};

type RosterMember = {
  id: number;
  name: string;
  trade: string | null;
  availability: string;
  openAssignments: number;
};

type CrewPayload = {
  workersNeeded: number | null;
  progress: {
    assigned: number;
    required: number | null;
    satisfied: boolean;
    shortfall: number;
    label: string;
  };
  assignments: CrewAssignmentView[];
  roster: RosterMember[];
};

/**
 * The crew panel: who is on the case, who else is free, and how far the plan
 * has been staffed ("2 of 3 assigned"). Assignment is by name; releasing needs
 * a reason. The shortfall override is offered right here, because that is the
 * moment an official realises they have to start anyway.
 */
export function CrewPanel({
  concernId,
  locale = "en",
  canAssign = true,
  canOverrideShortfall = false,
}: {
  concernId: number;
  locale?: Locale;
  canAssign?: boolean;
  canOverrideShortfall?: boolean;
}) {
  const t = copy[locale].revamp.workflow;
  const router = useRouter();
  const [data, setData] = useState<CrewPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [releasing, setReleasing] = useState<number | null>(null);
  const [releaseReason, setReleaseReason] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [showOverride, setShowOverride] = useState(false);

  const load = useCallback(async () => {
    const result = await apiRequest<CrewPayload>(
      `/api/v1/concerns/${concernId}/crew`
    );
    if (!result.success) {
      setLoadError(result.error.message);
      return;
    }
    setLoadError(null);
    setData(result.data);
  }, [concernId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function assign() {
    if (selected.length === 0) return;
    setBusy(true);
    setError(null);
    setMessage(null);

    const result = await apiRequest<{ progress: { label: string } }>(
      `/api/v1/concerns/${concernId}/crew`,
      { method: "POST", body: JSON.stringify({ crewIds: selected }) }
    );
    setBusy(false);

    if (!result.success) {
      setError(result.error.message);
      return;
    }
    setSelected([]);
    setMessage(`${t.crewAssignedToast} ${result.data.progress.label}`);
    await load();
    router.refresh();
  }

  async function release(crewId: number) {
    setBusy(true);
    setError(null);
    setMessage(null);

    const result = await apiRequest(
      `/api/v1/concerns/${concernId}/crew`,
      {
        method: "DELETE",
        body: JSON.stringify({ crewId, reason: releaseReason }),
      }
    );
    setBusy(false);

    if (!result.success) {
      setError(result.error.message);
      return;
    }
    setReleasing(null);
    setReleaseReason("");
    setMessage(t.crewReleasedToast);
    await load();
    router.refresh();
  }

  async function recordShortfallOverride() {
    setBusy(true);
    setError(null);
    setMessage(null);

    const result = await apiRequest(
      `/api/v1/concerns/${concernId}/overrides`,
      {
        method: "POST",
        body: JSON.stringify({
          kind: "CREW_SHORTFALL",
          reason: overrideReason,
          details: { source: "crew_panel" },
        }),
      }
    );
    setBusy(false);

    if (!result.success) {
      setError(result.error.message);
      return;
    }
    setOverrideReason("");
    setShowOverride(false);
    setMessage(t.overrideRecorded);
    router.refresh();
  }

  if (loadError) {
    return <FormMessage tone="error">{loadError}</FormMessage>;
  }
  if (!data) {
    return <p className="text-sm text-slate-500">{copy[locale].loading.label}</p>;
  }

  const active = data.assignments.filter((row) => row.isActive);
  const released = data.assignments.filter((row) => !row.isActive);
  const progress = data.progress;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={progress.satisfied ? "green" : "amber"}>
          {t.crewProgress}: {progress.label}
        </Badge>
        {!progress.satisfied && (
          <span className="text-xs text-slate-500">{t.crewGateHint}</span>
        )}
      </div>

      {message && <FormMessage tone="success">{message}</FormMessage>}
      {error && <FormMessage tone="error">{error}</FormMessage>}

      <ul className="divide-y divide-slate-100">
        {active.map((row) => (
          <li key={row.id} className="flex items-center justify-between gap-3 py-2">
            <div>
              <p className="text-sm font-medium text-slate-900">{row.name}</p>
              {row.trade && (
                <p className="text-xs text-slate-500">{row.trade}</p>
              )}
            </div>
            {canAssign &&
              (releasing === row.crewId ? (
                <div className="flex w-full max-w-sm flex-col gap-2">
                  <Label htmlFor={`release-${row.crewId}`} required>
                    {t.crewReleaseReason}
                  </Label>
                  <Input
                    id={`release-${row.crewId}`}
                    value={releaseReason}
                    onChange={(event) => setReleaseReason(event.target.value)}
                    placeholder={t.crewReleasePlaceholder}
                  />
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy || releaseReason.trim().length < 5}
                      onClick={() => release(row.crewId)}
                    >
                      {t.crewReleaseConfirm}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setReleasing(null);
                        setReleaseReason("");
                      }}
                    >
                      {copy[locale].revamp.common.cancel}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!canAssign || busy}
                  onClick={() => setReleasing(row.crewId)}
                >
                  {t.crewRelease}
                </Button>
              ))}
          </li>
        ))}
        {active.length === 0 && (
          <li className="py-2 text-sm text-slate-500">{t.crewNoRoster}</li>
        )}
      </ul>

      {released.length > 0 && (
        <details className="text-xs text-slate-500">
          <summary>
            {t.crewRelease} · {released.length}
          </summary>
          <ul className="mt-2 space-y-1">
            {released.map((row) => (
              <li key={row.id}>
                {row.name}
                {row.releaseReason ? ` — ${row.releaseReason}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}

      {canAssign && data.roster.length > 0 && (
        <div className="space-y-3 border-t border-slate-100 pt-4">
          <p className="text-sm font-medium text-slate-700">{t.crewRoster}</p>
          <ul className="space-y-2">
            {data.roster.map((member) => {
              const already = active.some((row) => row.crewId === member.id);
              const selectable = !already && member.availability === "AVAILABLE";
              return (
                <li key={member.id}>
                  <label
                    className={`flex items-start gap-2 text-sm ${
                      selectable ? "text-slate-700" : "text-slate-400"
                    }`}
                  >
                    <input
                      type="checkbox"
                      disabled={!selectable}
                      checked={selected.includes(member.id)}
                      onChange={(event) =>
                        setSelected((prev) =>
                          event.target.checked
                            ? [...prev, member.id]
                            : prev.filter((id) => id !== member.id)
                        )
                      }
                      className="mt-0.5 h-4 w-4 rounded border-slate-300"
                    />
                    <span>
                      {member.name}
                      {member.trade ? ` · ${member.trade}` : ""}
                      <span className="block text-xs text-slate-500">
                        {t.crewOpenCases.replace(
                          "{count}",
                          String(member.openAssignments)
                        )}
                        {member.availability !== "AVAILABLE"
                          ? ` · ${t.crewNotAvailable}`
                          : ""}
                        {already ? ` · ✓` : ""}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <Button
            type="button"
            disabled={busy || selected.length === 0}
            loading={busy && selected.length > 0}
            onClick={assign}
          >
            {t.crewAssign}
          </Button>
        </div>
      )}

      {canOverrideShortfall && !progress.satisfied && (
        <div className="border-t border-slate-100 pt-4">
          {showOverride ? (
            <div className="space-y-2">
              <Label htmlFor="shortfall-reason" required>
                {t.crewShortfallReason}
              </Label>
              <Textarea
                id="shortfall-reason"
                rows={2}
                maxLength={1000}
                value={overrideReason}
                onChange={(event) => setOverrideReason(event.target.value)}
                placeholder={t.overridePlaceholder}
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={busy || overrideReason.trim().length < 15}
                  onClick={recordShortfallOverride}
                >
                  {t.overrideSubmit}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowOverride(false)}
                >
                  {copy[locale].revamp.common.cancel}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setShowOverride(true)}
            >
              {t.crewShortfallOverride}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
