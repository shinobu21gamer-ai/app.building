"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/field";
import { apiRequest } from "@/lib/api-client";
import { copy, type Locale } from "@/lib/i18n";

type ScanResult = {
  scanned: number;
  escalated: number;
  alreadyRecorded: number;
  status: "SUCCESS" | "FAILED";
  error: string | null;
};

/**
 * Runs the escalation job now. Same function the hourly cron calls, so this is
 * also the honest answer to "is the job actually working?".
 */
export function RunScanButton({ locale }: { locale: Locale }) {
  const t = copy[locale].revamp.slaDesk;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    const response = await apiRequest<ScanResult>("/api/v1/admin/sla/scan", {
      method: "POST",
    });
    setBusy(false);
    if (!response.success) {
      setError(response.error.message);
      return;
    }
    setResult(response.data);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <Button size="sm" loading={busy} onClick={run}>
        <RefreshCw size={14} aria-hidden="true" />
        {t.runScan}
      </Button>
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
      {result ? (
        <FormMessage tone={result.status === "SUCCESS" ? "success" : "error"}>
          {t.runSummary
            .replace("{escalated}", String(result.escalated))
            .replace("{scanned}", String(result.scanned))}
          {result.alreadyRecorded > 0
            ? ` ${t.runAlready.replace("{count}", String(result.alreadyRecorded))}`
            : ""}
        </FormMessage>
      ) : null}
    </div>
  );
}
