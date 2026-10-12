"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormMessage, Input, Label } from "@/components/ui/field";
import { apiRequest } from "@/lib/api-client";
import { copy, type Locale } from "@/lib/i18n";

type VerifyReport = {
  status: "OK" | "BROKEN" | "FAILED";
  fromSeq: string;
  toSeq: string;
  checkedCount: number;
  firstBrokenSeq: string | null;
  problem: string | null;
  boundaryUnverified: boolean;
  unchainedCount: number;
  tipSeq: string;
  runId: number | null;
};

/**
 * Runs a chain verification on demand. Whole chain by default; a range is for
 * re-checking a window after an incident without walking everything.
 */
export function VerifyButton({ locale }: { locale: Locale }) {
  const t = copy[locale].revamp.auditDesk;
  const router = useRouter();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<VerifyReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function verify() {
    setBusy(true);
    setError(null);
    setReport(null);
    const response = await apiRequest<{ report: VerifyReport }>(
      "/api/v1/admin/audit/verify",
      {
        method: "POST",
        body: JSON.stringify({
          fromSeq: from.trim() === "" ? undefined : from.trim(),
          toSeq: to.trim() === "" ? undefined : to.trim(),
        }),
      }
    );
    setBusy(false);
    if (!response.success) {
      setError(response.error.message);
      return;
    }
    setReport(response.data.report);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="verify-from">{t.fromSeq}</Label>
          <Input
            id="verify-from"
            inputMode="numeric"
            value={from}
            placeholder="1"
            onChange={(event) => setFrom(event.target.value.replace(/[^0-9]/g, ""))}
          />
        </div>
        <div>
          <Label htmlFor="verify-to">{t.toSeq}</Label>
          <Input
            id="verify-to"
            inputMode="numeric"
            value={to}
            placeholder={t.toSeqPlaceholder}
            onChange={(event) => setTo(event.target.value.replace(/[^0-9]/g, ""))}
          />
        </div>
      </div>

      <Button size="sm" loading={busy} onClick={verify}>
        <ShieldCheck size={14} aria-hidden="true" />
        {t.verify}
      </Button>

      {error ? <FormMessage tone="error">{error}</FormMessage> : null}

      {report ? (
        <FormMessage tone={report.status === "OK" ? "success" : "error"}>
          {report.status === "OK"
            ? t.verifyOk
                .replace("{checked}", String(report.checkedCount))
                .replace("{tip}", report.tipSeq)
            : t.verifyBroken
                .replace("{seq}", report.firstBrokenSeq ?? "—")
                .replace("{problem}", report.problem ?? "")}
          {report.unchainedCount > 0
            ? ` ${t.verifyUnchained.replace("{count}", String(report.unchainedCount))}`
            : ""}
          {report.boundaryUnverified ? ` ${t.verifyBoundary}` : ""}
        </FormMessage>
      ) : null}
    </div>
  );
}
