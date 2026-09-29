"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { loginSchema } from "@/lib/validations/auth";
import { apiRequest } from "@/lib/api-client";
import { extractFieldErrors } from "@/lib/validation-errors";
import { Button } from "@/components/ui/button";
import { FieldError, FormMessage, Input, Label } from "@/components/ui/field";

type LoginResponse = {
  user: {
    email: string;
    firstName: string;
    lastName: string;
    role: string | null;
  };
  redirect: string;
};

export function LoginForm({ nextPath }: { nextPath?: string | null }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const validateField = useCallback((name: "email" | "password", value: string) => {
    const fieldSchema = loginSchema.shape[name];
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
  }, []);

  const handleBlur = (name: "email" | "password", value: string) => {
    setTouched((prev) => ({ ...prev, [name]: true }));
    validateField(name, value);
  };

  const handleChange = (name: "email" | "password", value: string) => {
    if (name === "email") setEmail(value);
    if (name === "password") setPassword(value);
    if (touched[name]) {
      validateField(name, value);
    }
  };

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    setTouched({ email: true, password: true });

    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setFieldErrors(extractFieldErrors(parsed.error.issues));
      return;
    }

    setSubmitting(true);
    const result = await apiRequest<LoginResponse>("/api/v1/auth/login", {
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

    router.push(nextPath ?? result.data.redirect, { scroll: false });
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4" autoComplete="off">
      {error && <FormMessage tone="error">{error}</FormMessage>}

      <div>
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => handleChange("email", e.target.value)}
          onBlur={(e) => handleBlur("email", e.target.value)}
          invalid={Boolean(fieldErrors.email) && touched.email}
          disabled={submitting}
          placeholder="you@example.com"
          required
        />
        {touched.email && fieldErrors.email && <FieldError>{fieldErrors.email}</FieldError>}
      </div>

      <div>
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => handleChange("password", e.target.value)}
          onBlur={(e) => handleBlur("password", e.target.value)}
          invalid={Boolean(fieldErrors.password) && touched.password}
          disabled={submitting}
          required
        />
        {touched.password && fieldErrors.password && <FieldError>{fieldErrors.password}</FieldError>}
      </div>

      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? "Signing in…" : "Sign in"}
      </Button>

      {nextPath && (
        <p className="text-xs text-slate-500 text-center">
          You will be returned to <span className="font-medium">{nextPath}</span>{" "}
          after signing in.
        </p>
      )}
    </form>
  );
}