"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  FormMessage,
  Label,
  RequiredLegend,
  Textarea,
} from "@/components/ui/field";
import { apiRequest } from "@/lib/api-client";
import { copy, type Locale } from "@/lib/i18n";

/**
 * Approving an earmark is what actually reserves the money; cancelling gives
 * the reservation back. Cancelling always carries a reason.
 */
export function EarmarkActions({
  earmarkId,
  status,
  canApprove,
  canCancel,
  locale = "en",
}: {
  earmarkId: number;
  status: string;
  canApprove: boolean;
  canCancel: boolean;
  locale?: Locale;
}) {
  const t = copy[locale].revamp.treasuryDesk;
  const common = copy[locale].revamp.common;
  const router = useRouter();
  const [mode, setMode] = useState<"APPROVE" | "CANCEL" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (
    (status !== "PROPOSED" && status !== "APPROVED") ||
    (!canApprove && !canCancel)
  ) {
    return null;
  }

  async function run(action: "APPROVE" | "CANCEL", formData: FormData) {
    setBusy(true);
    setError(null);

    const reason = String(formData.get("reason") ?? "");
    const notes = String(formData.get("notes") ?? "");

    const result = await apiRequest<{ available: number }>(
      `/api/v1/treasury/earmarks/${earmarkId}`,
      {
        method: "PATCH",
        body: JSON.stringify(
          action === "APPROVE"
            ? { action, notes: notes === "" ? null : notes }
            : { action, reason }
        ),
      }
    );

    setBusy(false);
    if (!result.success) {
      setError(result.error.message);
      return;
    }
    setMode(null);
    router.refresh();
  }

  return (
    <div className="space-y-2">
      {error && <FormMessage tone="error">{error}</FormMessage>}

      {mode === null && (
        <div className="flex flex-wrap gap-2">
          {canApprove && status === "PROPOSED" && (
            <Button type="button" size="sm" onClick={() => setMode("APPROVE")}>
              {t.approveEarmark}
            </Button>
          )}
          {canCancel && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setMode("CANCEL")}
            >
              {t.cancelEarmark}
            </Button>
          )}
        </div>
      )}

      {mode !== null && (
        <form action={(formData) => run(mode, formData)} className="space-y-3">
          <RequiredLegend>{t.requiredLegend}</RequiredLegend>
          {mode === "APPROVE" && (
            <p className="text-sm text-slate-600">{t.earmarkApproved}</p>
          )}
          {mode === "CANCEL" && (
            <div>
              <Label htmlFor={`earmark-reason-${earmarkId}`} required>
                {t.cancelReason}
              </Label>
              <Textarea
                id={`earmark-reason-${earmarkId}`}
                name="reason"
                rows={2}
                minLength={5}
                maxLength={500}
                required
              />
            </div>
          )}
          {mode === "APPROVE" && (
            <div>
              <Label htmlFor={`earmark-notes-${earmarkId}`}>
                {t.verificationNotes}
              </Label>
              <Textarea
                id={`earmark-notes-${earmarkId}`}
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
