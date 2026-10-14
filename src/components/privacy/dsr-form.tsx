"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FieldError, FormMessage, Label, Textarea } from "@/components/ui/field";
import { apiRequest } from "@/lib/api-client";
import { copy, type Locale } from "@/lib/i18n";
import { DSR_TYPES, type DsrType } from "@/lib/privacy/catalog";

const selectStyles =
  "h-10 w-full rounded-control border border-line-strong bg-surface px-3 text-sm text-ink focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30";

/**
 * Files a data subject request (RA 10173).
 *
 * Erasure is the heaviest request, so the form warns what it does before it is
 * filed: the identity is erased, the case records the barangay must keep stay.
 */
export function DsrRequestForm({ locale = "en" }: { locale?: Locale }) {
  const t = copy[locale].revamp.privacyCenter;
  const router = useRouter();
  const [type, setType] = useState<DsrType | "">("");
  const [details, setDetails] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{
    tone: "error" | "success";
    text: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setFieldErrors({});

    const errors: Record<string, string> = {};
    if (!type) errors.type = t.requestType;
    if (!confirmed) errors.confirmed = t.confirm;
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setBusy(true);
    const result = await apiRequest<{ request: { referenceCode: string } }>(
      "/api/v1/privacy/requests",
      {
        method: "POST",
        body: JSON.stringify({
          type,
          details: details.trim() === "" ? undefined : details.trim(),
          confirmIdentity: true,
        }),
      }
    );
    setBusy(false);

    if (!result.success) {
      setMessage({ tone: "error", text: result.error.message });
      return;
    }

    setType("");
    setDetails("");
    setConfirmed(false);
    setMessage({
      tone: "success",
      text: `${t.submitted} ${result.data.request.referenceCode}`,
    });
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {message && <FormMessage tone={message.tone}>{message.text}</FormMessage>}

      <div>
        <Label htmlFor="dsr-type" required>
          {t.requestType}
        </Label>
        <select
          id="dsr-type"
          value={type}
          aria-required="true"
          onChange={(event) => setType(event.target.value as DsrType | "")}
          className={selectStyles}
          aria-describedby={fieldErrors.type ? "dsr-type-error" : undefined}
        >
          <option value="">—</option>
          {DSR_TYPES.map((value) => (
            <option key={value} value={value}>
              {t.requestTypes[value]}
            </option>
          ))}
        </select>
        {fieldErrors.type && <FieldError id="dsr-type-error">{fieldErrors.type}</FieldError>}
      </div>

      <div>
        <Label htmlFor="dsr-details">{t.details}</Label>
        <Textarea
          id="dsr-details"
          value={details}
          onChange={(event) => setDetails(event.target.value)}
          rows={4}
          maxLength={2000}
          placeholder={t.detailsHint}
        />
      </div>

      <div>
        <label className="flex items-start gap-2 text-sm text-ink-muted">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            aria-required="true"
            aria-describedby={fieldErrors.confirmed ? "dsr-confirmed-error" : undefined}
            className="mt-0.5 h-4 w-4 rounded border-line-strong"
          />
          <span>
            {t.confirm}
          </span>
        </label>
        {fieldErrors.confirmed && (
          <FieldError id="dsr-confirmed-error">{fieldErrors.confirmed}</FieldError>
        )}
      </div>

      <Button type="submit" loading={busy} disabled={busy}>
        {busy ? t.submitting : t.submit}
      </Button>
    </form>
  );
}
