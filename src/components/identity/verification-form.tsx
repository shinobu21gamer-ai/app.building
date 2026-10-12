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
      <p className="text-xs text-slate-500">{t.requiredLegend}</p>

      {identity.status !== "UNVERIFIED" && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
          <p className="font-medium text-slate-800">
            {t.verification.statusTitle}:{" "}
            <span className="font-semibold">
              {t.verification.statusLabels[identity.status]}
            </span>
          </p>
          {identity.idNumberLast4 && (
            <p className="mt-1 text-xs text-slate-600">
              {t.verification.last4Label}: ••••{identity.idNumberLast4}
            </p>
          )}
          {identity.decisionReason && (
            <p className="mt-1 text-xs text-slate-600">
              {t.verification.decisionLabel}: {identity.decisionReason}
            </p>
          )}
        </div>
      )}

      {!identity.canResubmit ? (
        <p className="text-sm text-slate-600">
          {identity.status === "VERIFIED"
            ? t.verification.statusLabels.VERIFIED
            : t.verification.submitted}
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {message && <FormMessage tone={message.tone}>{message.text}</FormMessage>}

          <div>
            <Label htmlFor="identity-method">
              {t.verification.method}
            </Label>
            <select
              id="identity-method"
              name="method"
              value={method}
              onChange={(event) => setMethod(event.target.value)}
              aria-required="true"
              className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30"
            >
              <option value="">{t.verification.methodPlaceholder}</option>
              {ID_METHODS.map((value) => (
                <option key={value} value={value}>
                  {IDENTITY_METHOD_LABELS[value]}
                </option>
              ))}
            </select>
            {fieldErrors.method && <FieldError>{fieldErrors.method}</FieldError>}
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
                maxLength={80}
              />
              {fieldErrors.idTypeLabel && (
                <FieldError>{fieldErrors.idTypeLabel}</FieldError>
              )}
            </div>
          )}

          <div>
            <Label htmlFor="identity-number">
              {t.verification.idNumber}
            </Label>
            <Input
              id="identity-number"
              value={idNumber}
              onChange={(event) => setIdNumber(event.target.value)}
              aria-required="true"
              autoComplete="off"
              maxLength={40}
            />
            <p className="mt-1 text-xs text-slate-500">
              {t.verification.idNumberHint}
            </p>
            {fieldErrors.idNumber && <FieldError>{fieldErrors.idNumber}</FieldError>}
          </div>

          <div>
            <Label htmlFor="identity-image">
              {t.verification.idPhoto}
            </Label>
            <input
              id="identity-image"
              name="idImage"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              aria-required="true"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border file:border-slate-300 file:bg-white file:px-3 file:py-2 file:text-sm"
            />
            <p className="mt-1 text-xs text-slate-500">
              {t.verification.idPhotoHint}
            </p>
            {fieldErrors.idImage && <FieldError>{fieldErrors.idImage}</FieldError>}
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-slate-700">
              {t.verification.consentIdVerification}
            </legend>
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={confirmAccuracy}
                onChange={(event) => setConfirmAccuracy(event.target.checked)}
                aria-required="true"
                className="mt-0.5 h-4 w-4 rounded border-slate-300"
              />
              <span>{t.verification.confirmAccuracy}</span>
            </label>
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
                aria-required="true"
                className="mt-0.5 h-4 w-4 rounded border-slate-300"
              />
              <span>{t.verification.consentIdVerification}</span>
            </label>
            {fieldErrors.confirm && <FieldError>{fieldErrors.confirm}</FieldError>}
          </fieldset>

          <Button type="submit" loading={busy} disabled={busy}>
            {busy ? t.verification.submitting : t.verification.submit}
          </Button>
        </form>
      )}
    </div>
  );
}
