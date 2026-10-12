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
 * approve it (which opens it on the ledger), adjust it (administrator only,
 * always with a memo), or close it (only when nothing is reserved).
 */
export function AllocationActions({
  allocationId,
  status,
  available,
  canApprove,
  canAdjust,
  canClose,
  locale = "en",
}: {
  allocationId: number;
  status: string;
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

  async function run(action: Action, formData: FormData) {
    setBusy(true);
    setError(null);
    setDone(null);

    const notes = String(formData.get("notes") ?? "");
    const memo = String(formData.get("memo") ?? "");
    const payload =
      action === "ADJUST"
        ? { action, amount: Number(formData.get("amount")), memo }
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
              onClick={() => setMode("ADJUST")}
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
                  {t.amountLabel}
                </Label>
                <Input
                  id="adjust-amount"
                  name="amount"
                  type="number"
                  step="0.01"
                  required
                  placeholder="-500.00"
                />
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
