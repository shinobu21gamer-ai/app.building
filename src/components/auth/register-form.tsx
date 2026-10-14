"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { registerSchema } from "@/lib/validations/auth";
import { apiRequest } from "@/lib/api-client";
import { extractFieldErrors } from "@/lib/validation-errors";
import { Button } from "@/components/ui/button";
import { FieldError, FormMessage, Input, Label } from "@/components/ui/field";
import { copy, type Locale } from "@/lib/i18n";

type RegisterResponse = {
  user: { email: string; firstName: string; lastName: string };
  redirect: string;
};

type FormData = {
  email: string;
  password: string;
  confirmPassword: string;
  firstName: string;
  lastName: string;
  phone: string;
  address: string;
};

const initialForm: FormData = {
  email: "",
  password: "",
  confirmPassword: "",
  firstName: "",
  lastName: "",
  phone: "",
  address: "",
};

export function RegisterForm({ locale = "en" }: { locale?: Locale }) {
  const t = copy[locale].register;
  const router = useRouter();
  const [form, setForm] = useState<FormData>(initialForm);
  // RA 10173 consents. The first two are mandatory: the API rejects the
  // registration without them, so the form checks them before sending.
  const [consents, setConsents] = useState({
    dataProcessing: false,
    privacyNotice: false,
    transparency: false,
    notifications: false,
    sms: false,
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  type FormFieldName = keyof FormData | "confirmPassword";

const validateField = useCallback((name: FormFieldName, value: string) => {
    // For confirmPassword, we need special handling
    if (name === "confirmPassword") {
      if (value !== form.password) {
        setFieldErrors((prev) => ({ ...prev, confirmPassword: t.mismatch }));
      } else {
        setFieldErrors((prev) => {
          const next = { ...prev };
          delete next.confirmPassword;
          return next;
        });
      }
      return;
    }

    const fieldSchema = registerSchema.shape[name];
    if (fieldSchema) {
      const result = fieldSchema.safeParse(value);
      if (!result.success) {
        setFieldErrors((prev) => ({
          ...prev,
          [name]: extractFieldErrors(result.error.issues)[name] || t.invalidValue,
        }));
      } else {
        setFieldErrors((prev) => {
          const next = { ...prev };
          delete next[name];
          return next;
        });
      }
    }
  }, [form.password, t.mismatch, t.invalidValue]);

  const handleBlur = (name: FormFieldName, value: string) => {
    setTouched((prev) => ({ ...prev, [name]: true }));
    validateField(name, value);
  };

  const handleChange = (name: FormFieldName, value: string) => {
    setForm((prev) => ({ ...prev, [name]: value }));
    if (touched[name]) {
      validateField(name, value);
    }
  };

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    const allTouched = Object.keys(initialForm).reduce((acc, k) => ({ ...acc, [k]: true }), {});
    setTouched(allTouched);

    if (form.password !== form.confirmPassword) {
      setFieldErrors({ confirmPassword: t.mismatch });
      return;
    }

    if (!consents.dataProcessing || !consents.privacyNotice) {
      setError(t.consentRequired);
      return;
    }

    const parsed = registerSchema.safeParse({
      email: form.email,
      password: form.password,
      firstName: form.firstName,
      lastName: form.lastName,
      phone: form.phone,
      address: form.address,
      consentDataProcessing: consents.dataProcessing,
      consentPrivacyNotice: consents.privacyNotice,
      consentTransparencyPublication: consents.transparency,
      consentNotifications: consents.notifications,
      consentSms: consents.sms,
    });

    if (!parsed.success) {
      setFieldErrors(extractFieldErrors(parsed.error.issues));
      return;
    }

    setSubmitting(true);
    const result = await apiRequest<RegisterResponse>("/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify(parsed.data),
    });

    if (!result.success) {
      setSubmitting(false);
      if (result.error.code === "VALIDATION_ERROR") {
        setFieldErrors(extractFieldErrors(result.error.details));
      } else {
        setError(result.error.message);
      }
      return;
    }

    window.dispatchEvent(new Event("native-auth-ready"));
    router.push(result.data.redirect, { scroll: false });
    router.refresh();
  }

  const isInvalid = (name: string) => Boolean(fieldErrors[name]) && touched[name];

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4" autoComplete="off">
      {error && <FormMessage tone="error">{error}</FormMessage>}
      <p className="text-xs text-ink-subtle">{t.requiredLegend}</p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="firstName" required>{t.firstName}</Label>
          <Input
            id="firstName"
            name="firstName"
            value={form.firstName}
            onChange={(e) => handleChange("firstName", e.target.value)}
            onBlur={(e) => handleBlur("firstName", e.target.value)}
            invalid={isInvalid("firstName")}
            aria-describedby={isInvalid("firstName") ? "firstName-error" : undefined}
            disabled={submitting}
            required
          />
          {isInvalid("firstName") && (
            <FieldError id="firstName-error">{fieldErrors.firstName}</FieldError>
          )}
        </div>
        <div>
          <Label htmlFor="lastName" required>{t.lastName}</Label>
          <Input
            id="lastName"
            name="lastName"
            value={form.lastName}
            onChange={(e) => handleChange("lastName", e.target.value)}
            onBlur={(e) => handleBlur("lastName", e.target.value)}
            invalid={isInvalid("lastName")}
            aria-describedby={isInvalid("lastName") ? "lastName-error" : undefined}
            disabled={submitting}
            required
          />
          {isInvalid("lastName") && (
            <FieldError id="lastName-error">{fieldErrors.lastName}</FieldError>
          )}
        </div>
      </div>

      <div>
        <Label htmlFor="email" required>{t.email}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          value={form.email}
          onChange={(e) => handleChange("email", e.target.value)}
          onBlur={(e) => handleBlur("email", e.target.value)}
          invalid={isInvalid("email")}
          aria-describedby={isInvalid("email") ? "email-error" : undefined}
          disabled={submitting}
          placeholder="you@example.com"
          required
        />
        {isInvalid("email") && (
          <FieldError id="email-error">{fieldErrors.email}</FieldError>
        )}
      </div>

      <div>
        <Label htmlFor="phone">{t.phone}</Label>
        <Input
          id="phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          value={form.phone}
          onChange={(e) => handleChange("phone", e.target.value)}
          onBlur={(e) => handleBlur("phone", e.target.value)}
          invalid={isInvalid("phone")}
          aria-describedby={isInvalid("phone") ? "phone-error" : undefined}
          disabled={submitting}
          placeholder="0917-000-0000"
        />
        {isInvalid("phone") && (
          <FieldError id="phone-error">{fieldErrors.phone}</FieldError>
        )}
      </div>

      <div>
        <Label htmlFor="address">{t.address}</Label>
        <Input
          id="address"
          name="address"
          value={form.address}
          onChange={(e) => handleChange("address", e.target.value)}
          onBlur={(e) => handleBlur("address", e.target.value)}
          invalid={isInvalid("address")}
          aria-describedby={isInvalid("address") ? "address-error" : undefined}
          disabled={submitting}
          placeholder={t.addressPlaceholder}
        />
        {isInvalid("address") && (
          <FieldError id="address-error">{fieldErrors.address}</FieldError>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="password" required>{t.password}</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={(e) => handleChange("password", e.target.value)}
            onBlur={(e) => handleBlur("password", e.target.value)}
            invalid={isInvalid("password")}
            aria-describedby={isInvalid("password") ? "password-error" : undefined}
            disabled={submitting}
            required
          />
          {isInvalid("password") && (
            <FieldError id="password-error">{fieldErrors.password}</FieldError>
          )}
          <p className="mt-1 text-xs text-ink-subtle">
            {t.passwordHint}
          </p>
        </div>
        <div>
          <Label htmlFor="confirmPassword" required>{t.confirmPassword}</Label>
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            value={form.confirmPassword}
            onChange={(e) => handleChange("confirmPassword", e.target.value)}
            onBlur={(e) => handleBlur("confirmPassword", e.target.value)}
            invalid={isInvalid("confirmPassword")}
            aria-describedby={isInvalid("confirmPassword") ? "confirmPassword-error" : undefined}
            disabled={submitting}
            required
          />
          {isInvalid("confirmPassword") && (
            <FieldError id="confirmPassword-error">{fieldErrors.confirmPassword}</FieldError>
          )}
        </div>
      </div>

      <fieldset className="space-y-3 rounded-control border border-line px-4 py-3">
        <legend className="px-1 text-sm font-semibold text-ink">
          {t.consentTitle}
        </legend>
        <p className="text-xs leading-relaxed text-ink-subtle">
          {t.consentLegend}
        </p>

        {(
          [
            ["dataProcessing", t.consentDataProcessing, true],
            ["privacyNotice", t.consentPrivacyNotice, true],
            ["transparency", t.consentTransparency, false],
            ["notifications", t.consentNotifications, false],
            ["sms", t.consentSms, false],
          ] as const
        ).map(([key, label, required]) => (
          <label
            key={key}
            className="flex items-start gap-2 text-sm text-ink-muted"
          >
            <input
              type="checkbox"
              checked={consents[key]}
              aria-required={required || undefined}
              onChange={(event) =>
                setConsents((prev) => ({ ...prev, [key]: event.target.checked }))
              }
              className="mt-0.5 h-4 w-4 rounded border-line-strong"
            />
            <span>
              {label}
              {required ? (
                <span aria-hidden="true" className="ml-0.5 text-danger-600">
                  *
                </span>
              ) : null}
            </span>
          </label>
        ))}
      </fieldset>

      <p className="text-xs text-ink-subtle">{t.requiredLegend}</p>

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