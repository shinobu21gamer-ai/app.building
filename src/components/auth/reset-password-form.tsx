"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { resetPasswordSchema } from "@/lib/validations/auth";
import { apiRequest } from "@/lib/api-client";
import { extractFieldErrors } from "@/lib/validation-errors";
import { Button } from "@/components/ui/button";
import { FieldError, FormMessage, Input, Label } from "@/components/ui/field";
import { copy, type Locale } from "@/lib/i18n";

export function ResetPasswordForm({ locale = "en" }: { locale?: Locale }) {
  const t = copy[locale].reset;
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});

    const parsed = resetPasswordSchema.safeParse({ email, code, newPassword });
    if (!parsed.success) {
      setFieldErrors(extractFieldErrors(parsed.error.issues));
      return;
    }

    setSubmitting(true);
    const result = await apiRequest<{ success: boolean }>(
      "/api/v1/auth/reset-password",
      { method: "POST", body: JSON.stringify(parsed.data) }
    );
    setSubmitting(false);

    if (!result.success) {
      setError(result.error.message);
      return;
    }

    setDone(true);
    router.refresh();
  }

  if (done) {
    return (
      <div className="space-y-4">
        <FormMessage tone="success">
          {t.done}{" "}
          <a
            href="/login"
            className="font-semibold text-emerald-800 underline hover:text-emerald-900"
          >
            {t.signIn}
          </a>
          .
        </FormMessage>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      {error && <FormMessage tone="error">{error}</FormMessage>}
      <p className="text-sm leading-relaxed text-slate-600">{t.lead}</p>

      <div>
        <Label htmlFor="email">{t.email}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          invalid={Boolean(fieldErrors.email)}
          disabled={submitting}
          placeholder="you@example.com"
          required
        />
        {fieldErrors.email && <FieldError>{fieldErrors.email}</FieldError>}
      </div>

      <div>
        <Label htmlFor="code">{t.code}</Label>
        <Input
          id="code"
          name="code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          invalid={Boolean(fieldErrors.code)}
          disabled={submitting}
          placeholder="e.g. 8F2C41D77E3A09B5"
          autoCapitalize="characters"
          spellCheck={false}
          autoComplete="one-time-code"
          required
        />
        {fieldErrors.code && <FieldError>{fieldErrors.code}</FieldError>}
      </div>

      <div>
        <Label htmlFor="newPassword">{t.newPassword}</Label>
        <Input
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          invalid={Boolean(fieldErrors.newPassword)}
          disabled={submitting}
          placeholder={t.newPasswordPlaceholder}
          required
        />
        {fieldErrors.newPassword && (
          <FieldError>{fieldErrors.newPassword}</FieldError>
        )}
      </div>

      <Button
        type="submit"
        disabled={submitting}
        loading={submitting}
        className="w-full"
      >
        {submitting ? t.submitting : t.submit}
      </Button>
    </form>
  );
}