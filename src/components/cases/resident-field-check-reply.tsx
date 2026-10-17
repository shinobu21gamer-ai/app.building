"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/lib/api-client";
import { copy, type Locale } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { FormMessage, Label, Textarea } from "@/components/ui/field";

/** Resident response form shown only while their own case has an open field check. */
export function ResidentFieldCheckReply({
  concernId,
  fieldCheckId,
  locale,
}: {
  concernId: number;
  fieldCheckId: number;
  locale: Locale;
}) {
  const t = copy[locale].resident.fieldCheckReply;
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!message.trim() || busy) return;
    setBusy(true);
    setError(null);
    setSent(false);
    const result = await apiRequest(
      `/api/v1/concerns/${concernId}/field-checks/${fieldCheckId}/replies`,
      {
        method: "POST",
        body: JSON.stringify({ message }),
      }
    );
    setBusy(false);
    if (!result.success) {
      setError(result.error.message || t.error);
      return;
    }
    setMessage("");
    setSent(true);
    router.refresh();
  }

  return (
    <section className="rounded-card border border-brand-200 bg-brand-50/50 p-4 sm:p-5">
      <div className="mb-3 space-y-1">
        <h2 className="font-semibold text-ink">{t.title}</h2>
        <p className="text-sm leading-relaxed text-ink-muted">{t.lead}</p>
      </div>
      <form onSubmit={submit} className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor={`field-check-reply-${fieldCheckId}`}>{t.label}</Label>
          <Textarea
            id={`field-check-reply-${fieldCheckId}`}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            rows={3}
            maxLength={1000}
            required
            placeholder={t.placeholder}
          />
        </div>
        {error && <FormMessage tone="error">{error}</FormMessage>}
        {sent && <FormMessage tone="success">{t.sent}</FormMessage>}
        <Button type="submit" loading={busy} disabled={busy || !message.trim()}>
          {busy ? t.sending : t.send}
        </Button>
      </form>
    </section>
  );
}
