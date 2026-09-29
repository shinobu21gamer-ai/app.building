"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/field";
import { apiRequest } from "@/lib/api-client";

export function MaintenanceActions() {
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
    setMessage(
      result.success
        ? label
        : result.error.message
    );
    setFailed(!result.success);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => run("/api/v1/admin/sla/scan", "SLA scan completed.")}
      >
        Scan SLA breaches
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() =>
          run("/api/v1/admin/email-deliveries/retry", "Email retry completed.")
        }
      >
        Retry failed emails
      </Button>
      {message && <FormMessage tone={failed ? "error" : "success"}>{message}</FormMessage>}
    </div>
  );
}
