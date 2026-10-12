"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  FormMessage,
  Input,
  Label,
  RequiredLegend,
  Textarea,
} from "@/components/ui/field";
import { apiRequest } from "@/lib/api-client";
import { copy, type Locale } from "@/lib/i18n";

const selectStyles =
  "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30";

/**
 * Records where a COA code (or a fund source) was checked. Verifying without a
 * source is not possible: the whole point is that the provenance can be shown
 * again during an audit.
 */
export function VerifyRecordForm({
  kind,
  recordId,
  currentStatus,
  locale = "en",
}: {
  kind: "COA" | "FUND";
  recordId: number;
  currentStatus: string;
  locale?: Locale;
}) {
  const t = copy[locale].revamp.treasuryDesk;
  const common = copy[locale].revamp.common;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("VERIFIED");

  if (!open) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        {currentStatus === "VERIFIED" ? t.markDeprecated : t.verifyCode}
      </Button>
    );
  }

  const endpoint =
    kind === "COA"
      ? `/api/v1/admin/treasury/accounts/${recordId}`
      : `/api/v1/admin/treasury/fund-sources/${recordId}`;

  async function submit(formData: FormData) {
    setBusy(true);
    setError(null);

    const url = String(formData.get("verificationUrl") ?? "");
    const notes = String(formData.get("verificationNotes") ?? "");

    const result = await apiRequest<{ account?: unknown; fundSource?: unknown }>(
      endpoint,
      {
        method: "PATCH",
        body: JSON.stringify({
          verificationStatus: status,
          verificationSource: String(formData.get("verificationSource") ?? ""),
          ...(url === "" ? {} : { verificationUrl: url }),
          ...(notes === "" ? {} : { verificationNotes: notes }),
        }),
      }
    );

    setBusy(false);
    if (!result.success) {
      setError(result.error.message);
      return;
    }
    setOpen(false);
    router.refresh();
  }

  const needsUrl = status === "VERIFIED" && kind === "COA";

  return (
    <form action={submit} className="space-y-3">
      <RequiredLegend>{t.requiredLegend}</RequiredLegend>
      {error && <FormMessage tone="error">{error}</FormMessage>}

      <div>
        <Label htmlFor={`verify-status-${recordId}`} required>
          {common.status}
        </Label>
        <select
          id={`verify-status-${recordId}`}
          name="verificationStatus"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className={selectStyles}
        >
          <option value="VERIFIED">VERIFIED</option>
          <option value="UNVERIFIED">UNVERIFIED</option>
          <option value="DEPRECATED">DEPRECATED</option>
        </select>
      </div>

      <div>
        <Label htmlFor={`verify-source-${recordId}`} required>
          {t.verificationSource}
        </Label>
        <Input
          id={`verify-source-${recordId}`}
          name="verificationSource"
          required
          maxLength={200}
          placeholder="COA Government Accounting Manual, Volume I"
        />
      </div>

      {kind === "COA" && (
        <div>
          <Label htmlFor={`verify-url-${recordId}`} required={needsUrl}>
            {t.verificationUrl}
          </Label>
          <Input
            id={`verify-url-${recordId}`}
            name="verificationUrl"
            required={needsUrl}
            maxLength={500}
            placeholder="https://www.coa.gov.ph/..."
          />
        </div>
      )}

      <div>
        <Label htmlFor={`verify-notes-${recordId}`}>
          {t.verificationNotes}
        </Label>
        <Textarea
          id={`verify-notes-${recordId}`}
          name="verificationNotes"
          rows={2}
          maxLength={500}
        />
      </div>

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? common.saving : common.save}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setOpen(false)}
          disabled={busy}
        >
          {common.cancel}
        </Button>
      </div>
    </form>
  );
}
