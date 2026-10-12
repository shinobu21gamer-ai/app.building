"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormMessage, Input, Label } from "@/components/ui/field";
import { apiRequest } from "@/lib/api-client";
import { copy, type Locale } from "@/lib/i18n";

/**
 * Acknowledge or resolve one escalation.
 *
 * Acknowledging says "seen, someone owns it now". Resolving demands a note: an
 * escalation closed with no explanation is exactly how a late case becomes an
 * invisible one, so the button stays disabled until there is something to read.
 */
export function EscalationActions({
  id,
  locale,
  status,
}: {
  id: number;
  locale: Locale;
  status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED";
}) {
  const t = copy[locale].revamp.slaDesk;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"ACKNOWLEDGE" | "RESOLVE" | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (status === "RESOLVED") {
    return <span className="text-xs text-ink-subtle">{t.resolved}</span>;
  }

  async function act(action: "ACKNOWLEDGE" | "RESOLVE") {
    setBusy(action);
    setError(null);
    const result = await apiRequest(`/api/v1/sla/escalations/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ action, note: note.trim() || undefined }),
    });
    setBusy(null);
    if (!result.success) {
      setError(result.error.message);
      return;
    }
    setNote("");
    setOpen(false);
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {status === "OPEN" ? (
          <Button
            size="sm"
            variant="outline"
            loading={busy === "ACKNOWLEDGE"}
            onClick={() => act("ACKNOWLEDGE")}
          >
            {t.acknowledge}
          </Button>
        ) : null}
        <Button
          size="sm"
          variant={status === "OPEN" ? "ghost" : "secondary"}
          onClick={() => setOpen((value) => !value)}
        >
          {t.resolve}
        </Button>
      </div>

      {open ? (
        <div className="space-y-2 rounded-control border border-line bg-surface-muted p-3">
          <Label htmlFor={`escalation-note-${id}`} required>
            {t.resolveNote}
          </Label>
          <Input
            id={`escalation-note-${id}`}
            value={note}
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t.resolveNotePlaceholder}
          />
          <Button
            size="sm"
            loading={busy === "RESOLVE"}
            disabled={note.trim().length === 0}
            onClick={() => act("RESOLVE")}
          >
            {t.resolveConfirm}
          </Button>
        </div>
      ) : null}

      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
    </div>
  );
}
