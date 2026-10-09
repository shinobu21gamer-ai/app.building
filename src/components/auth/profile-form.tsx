"use client";

import { useState } from "react";
import { updateProfileSchema } from "@/lib/validations/auth";
import { apiRequest } from "@/lib/api-client";
import { extractFieldErrors } from "@/lib/validation-errors";
import { Button } from "@/components/ui/button";
import { FieldError, FormMessage, Input, Label } from "@/components/ui/field";
import { copy, type Locale } from "@/lib/i18n";

type ProfileUser = {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  address: string | null;
};

export function ProfileForm({
  user,
  locale = "en",
}: {
  user: ProfileUser;
  locale?: Locale;
}) {
  const t = copy[locale].profile;
  const [form, setForm] = useState({
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone ?? "",
    address: user.address ?? "",
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{
    tone: "error" | "success";
    text: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function setField(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    setFieldErrors({});

    const parsed = updateProfileSchema.safeParse(form);
    if (!parsed.success) {
      setFieldErrors(extractFieldErrors(parsed.error.issues));
      return;
    }

    setSubmitting(true);
    const result = await apiRequest<{ user: ProfileUser }>(
      "/api/v1/auth/profile",
      {
        method: "PATCH",
        body: JSON.stringify(parsed.data),
      }
    );
    setSubmitting(false);

    if (!result.success) {
      if (result.error.code === "VALIDATION_ERROR") {
        setFieldErrors(extractFieldErrors(result.error.details));
      } else {
        setMessage({ tone: "error", text: result.error.message });
      }
      return;
    }

    setMessage({ tone: "success", text: t.saved });
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      {message && (
        <FormMessage tone={message.tone}>{message.text}</FormMessage>
      )}

      <div>
        <Label htmlFor="email">{t.email}</Label>
        <Input id="email" value={user.email} disabled readOnly />
        <p className="mt-1 text-xs text-slate-500">{t.emailLocked}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="firstName">{t.firstName}</Label>
          <Input
            id="firstName"
            value={form.firstName}
            onChange={(e) => setField("firstName", e.target.value)}
            invalid={Boolean(fieldErrors.firstName)}
            disabled={submitting}
            required
          />
          {fieldErrors.firstName && (
            <FieldError>{fieldErrors.firstName}</FieldError>
          )}
        </div>
        <div>
          <Label htmlFor="lastName">{t.lastName}</Label>
          <Input
            id="lastName"
            value={form.lastName}
            onChange={(e) => setField("lastName", e.target.value)}
            invalid={Boolean(fieldErrors.lastName)}
            disabled={submitting}
            required
          />
          {fieldErrors.lastName && (
            <FieldError>{fieldErrors.lastName}</FieldError>
          )}
        </div>
      </div>

      <div>
        <Label htmlFor="phone">{t.phone}</Label>
        <Input
          id="phone"
          type="tel"
          value={form.phone}
          onChange={(e) => setField("phone", e.target.value)}
          invalid={Boolean(fieldErrors.phone)}
          disabled={submitting}
        />
        {fieldErrors.phone && <FieldError>{fieldErrors.phone}</FieldError>}
      </div>

      <div>
        <Label htmlFor="address">{t.address}</Label>
        <Input
          id="address"
          value={form.address}
          onChange={(e) => setField("address", e.target.value)}
          invalid={Boolean(fieldErrors.address)}
          disabled={submitting}
        />
        {fieldErrors.address && <FieldError>{fieldErrors.address}</FieldError>}
      </div>

      <Button type="submit" disabled={submitting}>
        {submitting ? t.saving : t.save}
      </Button>
    </form>
  );
}