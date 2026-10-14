"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldError, FormMessage, Input, Label } from "@/components/ui/field";
import { apiRequest } from "@/lib/api-client";
import { extractFieldErrors } from "@/lib/validation-errors";
import { copy, type Locale } from "@/lib/i18n";
import {
  IDENTITY_METHOD_LABELS,
  ID_METHODS,
  type IdentityStatus,
} from "@/lib/identity/policy";

type IdentityView = {
  status: IdentityStatus;
  method: string | null;
  idTypeLabel: string | null;
  idNumberLast4: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  decisionReason: string | null;
  verifiedAt: string | null;
  hasIdImage: boolean;
  canResubmit: boolean;
};

/**
 * Resident identity submission.
 *
 * Required fields are marked with `*` (see the legend rendered above the form)
 * and every acknowledgement is a real checkbox: the API rejects the paperwork
 * without them, so the browser must not be the only thing enforcing it.
 */
export function VerificationForm({
  initial,
  locale = "en",
}: {
  initial: IdentityView;
  locale?: Locale;
}) {
  const t = copy[locale].revamp;
  const [identity, setIdentity] = useState(initial);
  const [method, setMethod] = useState("");
  const [idTypeLabel, setIdTypeLabel] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [confirmAccuracy, setConfirmAccuracy] = useState(false);
  const [consent, setConsent] = useState(false);
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
    if (!method) errors.method = t.verification.methodPlaceholder;
    if (method === "OTHER" && idTypeLabel.trim() === "") {
      errors.idTypeLabel = t.verification.idTypeLabel;
    }
    if (idNumber.trim().length < 4) errors.idNumber = t.verification.idNumberHint;
    if (!file) errors.idImage = t.verification.idPhotoHint;
    if (!confirmAccuracy || !consent) {
      errors.confirm = t.verification.confirmAccuracy;
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    const form = new FormData();
    form.set("method", method);
    if (idTypeLabel.trim() !== "") form.set("idTypeLabel", idTypeLabel.trim());
    form.set("idNumber", idNumber.trim());
    form.set("confirmAccuracy", confirmAccuracy ? "true" : "false");
    form.set("consentIdVerification", consent ? "true" : "false");
    form.set("idImage", file!);

    setBusy(true);
    const result = await apiRequest<{ identity: IdentityView }>(
      "/api/v1/identity",
      { method: "POST", body: form }
    );
    setBusy(false);

    if (!result.success) {
      if (result.error.code === "VALIDATION_ERROR") {
        setFieldErrors(extractFieldErrors(result.error.details));
      } else {
        setMessage({ tone: "error", text: result.error.message });
      }
      return;
    }

    setIdentity(result.data.identity);
    setIdNumber("");
    setFile(null);
    setConfirmAccuracy(false);
    setConsent(false);
    setMessage({ tone: "success", text: t.verification.savedNow });
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-ink-subtle">{t.requiredLegend}</p>

      {identity.status !== "UNVERIFIED" && (
        <div className="rounded-control border border-line bg-surface-muted px-4 py-3 text-sm">
          <p className="font-medium text-ink">
            {t.verification.statusTitle}:{" "}
            <span className="font-semibold">
              {t.verification.statusLabels[identity.status]}
            </span>
          </p>
          {identity.idNumberLast4 && (
            <p className="mt-1 text-xs text-ink-muted">
              {t.verification.last4Label}: ••••{identity.idNumberLast4}
            </p>
          )}
          {identity.decisionReason && (
            <p className="mt-1 text-xs text-ink-muted">
              {t.verification.decisionLabel}: {identity.decisionReason}
            </p>
          )}
        </div>
      )}

      {!identity.canResubmit ? (
        <p className="text-sm text-ink-muted">
          {identity.status === "VERIFIED"
            ? t.verification.statusLabels.VERIFIED
            : t.verification.submitted}
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {message && <FormMessage tone={message.tone}>{message.text}</FormMessage>}

          <div>
            <Label htmlFor="identity-method" required>
              {t.verification.method}
            </Label>
            <select
              id="identity-method"
              name="method"
              value={method}
              onChange={(event) => setMethod(event.target.value)}
              aria-required="true"
              aria-describedby={fieldErrors.method ? "identity-method-error" : undefined}
              className="h-10 w-full rounded-control border border-line-strong bg-surface px-3 text-sm text-ink focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30"
            >
              <option value="">{t.verification.methodPlaceholder}</option>
              {ID_METHODS.map((value) => (
                <option key={value} value={value}>
                  {IDENTITY_METHOD_LABELS[value]}
                </option>
              ))}
            </select>
            {fieldErrors.method && (
              <FieldError id="identity-method-error">{fieldErrors.method}</FieldError>
            )}
          </div>

          {method === "OTHER" && (
            <div>
              <Label htmlFor="identity-type-label">
                {t.verification.idTypeLabel}
              </Label>
              <Input
                id="identity-type-label"
                value={idTypeLabel}
                onChange={(event) => setIdTypeLabel(event.target.value)}
                aria-required="true"
                aria-describedby={fieldErrors.idTypeLabel ? "identity-type-label-error" : undefined}
                maxLength={80}
              />
              {fieldErrors.idTypeLabel && (
                <FieldError id="identity-type-label-error">{fieldErrors.idTypeLabel}</FieldError>
              )}
            </div>
          )}

          <div>
            <Label htmlFor="identity-number" required>
              {t.verification.idNumber}
            </Label>
            <Input
              id="identity-number"
              value={idNumber}
              onChange={(event) => setIdNumber(event.target.value)}
              aria-required="true"
              autoComplete="off"
              maxLength={40}
              aria-describedby={fieldErrors.idNumber ? "identity-number-error" : "identity-number-hint"}
            />
            <p id="identity-number-hint" className="mt-1 text-xs text-ink-subtle">
              {t.verification.idNumberHint}
            </p>
            {fieldErrors.idNumber && (
              <FieldError id="identity-number-error">{fieldErrors.idNumber}</FieldError>
            )}
          </div>

          <div>
            <Label htmlFor="identity-image" required>
              {t.verification.idPhoto}
            </Label>
            <input
              id="identity-image"
              name="idImage"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              aria-required="true"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="block w-full text-sm text-ink-muted file:mr-3 file:rounded-control file:border file:border-line-strong file:bg-surface file:px-3 file:py-2 file:text-sm"
              aria-describedby={fieldErrors.idImage ? "identity-image-error" : "identity-image-hint"}
            />
            <p id="identity-image-hint" className="mt-1 text-xs text-ink-subtle">
              {t.verification.idPhotoHint}
            </p>
            {fieldErrors.idImage && (
              <FieldError id="identity-image-error">{fieldErrors.idImage}</FieldError>
            )}
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-ink-muted">
              {t.verification.consentIdVerification}
            </legend>
            <label className="flex items-start gap-2 text-sm text-ink-muted">
              <input
                type="checkbox"
                checked={confirmAccuracy}
                onChange={(event) => setConfirmAccuracy(event.target.checked)}
                aria-required="true"
                aria-describedby={fieldErrors.confirm ? "identity-confirm-error" : undefined}
                className="mt-0.5 h-4 w-4 rounded border-line-strong"
              />
              <span>{t.verification.confirmAccuracy}</span>
            </label>
            <label className="flex items-start gap-2 text-sm text-ink-muted">
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
                aria-required="true"
                aria-describedby={fieldErrors.confirm ? "identity-confirm-error" : undefined}
                className="mt-0.5 h-4 w-4 rounded border-line-strong"
              />
              <span>{t.verification.consentIdVerification}</span>
            </label>
            {fieldErrors.confirm && (
              <FieldError id="identity-confirm-error">{fieldErrors.confirm}</FieldError>
            )}
          </fieldset>

          <Button type="submit" loading={busy} disabled={busy}>
            {busy ? t.verification.submitting : t.verification.submit}
          </Button>
        </form>
      )}
    </div>
  );
}
