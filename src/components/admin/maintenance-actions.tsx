"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/field";
import { apiRequest } from "@/lib/api-client";
import { copy, type Locale } from "@/lib/i18n";

export function MaintenanceActions({ locale = "en" }: { locale?: Locale }) {
  const t = copy[locale].admin;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  async function run(path: string, label: string) {
    setBusy(true);
    setMessage(null);
    setFailed(false);
    const result = await apiRequest<{ breached?: number; sent?: number }>(path, {
      method: "POST",
    });
    setBusy(false);
    setMessage(result.success ? label : result.error.message);
    setFailed(!result.success);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => run("/api/v1/admin/sla/scan", t.slaDone)}
      >
        {t.scanSla}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() =>
          run("/api/v1/admin/email-deliveries/retry", t.emailRetryDone)
        }
      >
        {t.retryEmails}
      </Button>
      {message && (
        <FormMessage tone={failed ? "error" : "success"}>{message}</FormMessage>
      )}
    </div>
  );
}
