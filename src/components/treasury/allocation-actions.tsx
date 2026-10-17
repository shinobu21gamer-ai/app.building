"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  FormMessage,
  Input,
  Label,
  RequiredLegend,
  Textarea,
} from "@/components/ui/field";
import { apiRequest } from "@/lib/api-client";
import { formatPeso } from "@/lib/cases/manpower";
import { copy, type Locale } from "@/lib/i18n";

type Action = "APPROVE" | "ADJUST" | "CLOSE";

/**
 * The three things that can happen to an already-prepared appropriation:
 * approve it (which opens it on the ledger), adjust it (treasurer or
 * administrator, always with a memo), or close it (only when nothing is
 * reserved). Adjusting asks for the corrected appropriation total and
 * records the difference on the ledger — history is never rewritten.
 */
export function AllocationActions({
  allocationId,
  status,
  appropriated = 0,
  committed = 0,
  available,
  canApprove,
  canAdjust,
  canClose,
  locale = "en",
}: {
  allocationId: number;
  status: string;
  /** Current appropriated total; only needed when adjusting is offered. */
  appropriated?: number;
  /** Reserved + disbursed: the floor an adjustment may not go below. */
  committed?: number;
  available: number;
  canApprove: boolean;
  canAdjust: boolean;
  canClose: boolean;
  locale?: Locale;
}) {
  const t = copy[locale].revamp.treasuryDesk;
  const common = copy[locale].revamp.common;
  const router = useRouter();
  const [mode, setMode] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [newAppropriation, setNewAppropriation] = useState("");

  const parsedNew = Number(newAppropriation);
  const delta =
    newAppropriation.trim() !== "" && Number.isFinite(parsedNew)
      ? Math.round((parsedNew - appropriated) * 100) / 100
      : null;

  async function run(action: Action, formData: FormData) {
    setError(null);
    setDone(null);

    const notes = String(formData.get("notes") ?? "");
    const memo = String(formData.get("memo") ?? "");
    if (action === "ADJUST") {
      if (delta === null || delta === 0) {
        setError(t.adjustNoChange);
        return;
      }
      if (parsedNew < committed) {
        setError(
          t.adjustBelowCommitted.replace("{amount}", formatPeso(committed))
        );
        return;
      }
    }
    setBusy(true);

    const payload =
      action === "ADJUST"
        ? { action, amount: delta, memo }
        : { action, notes: notes === "" ? null : notes };

    const result = await apiRequest<{ available: number }>(
      `/api/v1/treasury/allocations/${allocationId}`,
      { method: "PATCH", body: JSON.stringify(payload) }
    );

    setBusy(false);
    if (!result.success) {
      setError(result.error.message);
      return;
    }
    setMode(null);
    setDone(
      action === "APPROVE"
        ? t.allocationApproved
        : action === "ADJUST"
          ? `${t.adjustAllocation} · ${formatPeso(result.data.available)}`
          : t.allocationClosed
    );
    router.refresh();
  }

  const blocked = status === "CLOSED";

  return (
    <div className="space-y-3">
      {error && <FormMessage tone="error">{error}</FormMessage>}
      {done && <FormMessage tone="success">{done}</FormMessage>}

      {mode === null && (
        <div className="flex flex-wrap items-center gap-2">
          {canApprove && status === "DRAFT" && (
            <Button type="button" size="sm" onClick={() => setMode("APPROVE")}>
              {t.approveAllocation}
            </Button>
          )}
          {canAdjust && status === "APPROVED" && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setNewAppropriation(String(appropriated));
                setMode("ADJUST");
              }}
            >
              {t.adjustAllocation}
            </Button>
          )}
          {canClose && !blocked && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setMode("CLOSE")}
            >
              {t.closeAllocation}
            </Button>
          )}
          {status === "APPROVED" && (
            <Badge tone="green">{formatPeso(available)}</Badge>
          )}
        </div>
      )}

      {mode !== null && (
        <form action={(formData) => run(mode, formData)} className="space-y-3">
          <RequiredLegend>{t.requiredLegend}</RequiredLegend>
          {mode === "APPROVE" && (
            <p className="text-sm text-ink-muted">
              {t.approveAllocation} — {t.allocationApproved}
            </p>
          )}
          {mode === "ADJUST" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="adjust-amount" required>
                  {t.adjustNewAppropriation}
                </Label>
                <Input
                  id="adjust-amount"
                  name="amount"
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={newAppropriation}
                  onChange={(event) => setNewAppropriation(event.target.value)}
                />
                <p className="mt-1 text-xs text-ink-subtle" role="status">
                  {delta === null || delta === 0
                    ? t.adjustNoChange
                    : (delta > 0 ? t.adjustIncrease : t.adjustDecrease)
                        .replace("{amount}", formatPeso(Math.abs(delta)))
                        .replace("{available}", formatPeso(available + delta))}
                </p>
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="adjust-memo" required>
                  {t.adjustMemo}
                </Label>
                <Textarea
                  id="adjust-memo"
                  name="memo"
                  rows={2}
                  minLength={10}
                  maxLength={500}
                  required
                />
              </div>
            </div>
          )}
          {(mode === "APPROVE" || mode === "CLOSE") && (
            <div>
              <Label htmlFor="allocation-notes">{t.verificationNotes}</Label>
              <Textarea
                id="allocation-notes"
                name="notes"
                rows={2}
                maxLength={500}
              />
            </div>
          )}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? common.saving : common.save}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setMode(null)}
              disabled={busy}
            >
              {common.cancel}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
