"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { registerSchema } from "@/lib/validations/auth";
import { apiRequest } from "@/lib/api-client";
import { extractFieldErrors } from "@/lib/validation-errors";
import { Button } from "@/components/ui/button";
import { FieldError, FormMessage, Input, Label } from "@/components/ui/field";

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

export function RegisterForm() {
  const router = useRouter();
  const [form, setForm] = useState<FormData>(initialForm);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  type FormFieldName = keyof FormData | "confirmPassword";

const validateField = useCallback((name: FormFieldName, value: string) => {
    // For confirmPassword, we need special handling
    if (name === "confirmPassword") {
      if (value !== form.password) {
        setFieldErrors((prev) => ({ ...prev, confirmPassword: "Passwords do not match." }));
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
          [name]: extractFieldErrors(result.error.issues)[name] || "Invalid value",
        }));
      } else {
        setFieldErrors((prev) => {
          const next = { ...prev };
          delete next[name];
          return next;
        });
      }
    }
  }, [form.password]);

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
      setFieldErrors({ confirmPassword: "Passwords do not match." });
      return;
    }

    const parsed = registerSchema.safeParse({
      email: form.email,
      password: form.password,
      firstName: form.firstName,
      lastName: form.lastName,
      phone: form.phone,
      address: form.address,
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

    router.push(result.data.redirect, { scroll: false });
    router.refresh();
  }

  const isInvalid = (name: string) => Boolean(fieldErrors[name]) && touched[name];

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4" autoComplete="off">
      {error && <FormMessage tone="error">{error}</FormMessage>}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="firstName">First name</Label>
          <Input
            id="firstName"
            name="firstName"
            value={form.firstName}
            onChange={(e) => handleChange("firstName", e.target.value)}
            onBlur={(e) => handleBlur("firstName", e.target.value)}
            invalid={isInvalid("firstName")}
            disabled={submitting}
            required
          />
          {isInvalid("firstName") && <FieldError>{fieldErrors.firstName}</FieldError>}
        </div>
        <div>
          <Label htmlFor="lastName">Last name</Label>
          <Input
            id="lastName"
            name="lastName"
            value={form.lastName}
            onChange={(e) => handleChange("lastName", e.target.value)}
            onBlur={(e) => handleBlur("lastName", e.target.value)}
            invalid={isInvalid("lastName")}
            disabled={submitting}
            required
          />
          {isInvalid("lastName") && <FieldError>{fieldErrors.lastName}</FieldError>}
        </div>
      </div>

      <div>
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          value={form.email}
          onChange={(e) => handleChange("email", e.target.value)}
          onBlur={(e) => handleBlur("email", e.target.value)}
          invalid={isInvalid("email")}
          disabled={submitting}
          placeholder="you@example.com"
          required
        />
        {isInvalid("email") && <FieldError>{fieldErrors.email}</FieldError>}
      </div>

      <div>
        <Label htmlFor="phone">Phone (optional)</Label>
        <Input
          id="phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          value={form.phone}
          onChange={(e) => handleChange("phone", e.target.value)}
          onBlur={(e) => handleBlur("phone", e.target.value)}
          invalid={isInvalid("phone")}
          disabled={submitting}
          placeholder="0917-000-0000"
        />
        {isInvalid("phone") && <FieldError>{fieldErrors.phone}</FieldError>}
      </div>

      <div>
        <Label htmlFor="address">Address (optional)</Label>
        <Input
          id="address"
          name="address"
          value={form.address}
          onChange={(e) => handleChange("address", e.target.value)}
          onBlur={(e) => handleBlur("address", e.target.value)}
          invalid={isInvalid("address")}
          disabled={submitting}
          placeholder="Purok, street, barangay"
        />
        {isInvalid("address") && <FieldError>{fieldErrors.address}</FieldError>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={(e) => handleChange("password", e.target.value)}
            onBlur={(e) => handleBlur("password", e.target.value)}
            invalid={isInvalid("password")}
            disabled={submitting}
            required
          />
          {isInvalid("password") && <FieldError>{fieldErrors.password}</FieldError>}
          <p className="mt-1 text-xs text-slate-500">
            At least 8 characters with a lowercase letter, uppercase letter, and
            number.
          </p>
        </div>
        <div>
          <Label htmlFor="confirmPassword">Confirm password</Label>
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            value={form.confirmPassword}
            onChange={(e) => handleChange("confirmPassword", e.target.value)}
            onBlur={(e) => handleBlur("confirmPassword", e.target.value)}
            invalid={isInvalid("confirmPassword")}
            disabled={submitting}
            required
          />
          {isInvalid("confirmPassword") && <FieldError>{fieldErrors.confirmPassword}</FieldError>}
        </div>
      </div>

      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}