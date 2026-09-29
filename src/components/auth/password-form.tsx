"use client";

import { useState } from "react";
import { changePasswordSchema } from "@/lib/validations/auth";
import { apiRequest } from "@/lib/api-client";
import { extractFieldErrors } from "@/lib/validation-errors";
import { Button } from "@/components/ui/button";
import { FieldError, FormMessage, Input, Label } from "@/components/ui/field";

export function PasswordForm() {
  const [form, setForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmNewPassword: "",
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

    if (form.newPassword !== form.confirmNewPassword) {
      setFieldErrors({ confirmNewPassword: "Passwords do not match." });
      return;
    }

    const parsed = changePasswordSchema.safeParse({
      currentPassword: form.currentPassword,
      newPassword: form.newPassword,
    });
    if (!parsed.success) {
      setFieldErrors(extractFieldErrors(parsed.error.issues));
      return;
    }

    setSubmitting(true);
    const result = await apiRequest<{ success: true }>(
      "/api/v1/auth/password",
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

    setForm({ currentPassword: "", newPassword: "", confirmNewPassword: "" });
    setMessage({ tone: "success", text: "Password changed." });
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      {message && (
        <FormMessage tone={message.tone}>{message.text}</FormMessage>
      )}

      <div>
        <Label htmlFor="currentPassword">Current password</Label>
        <Input
          id="currentPassword"
          type="password"
          autoComplete="current-password"
          value={form.currentPassword}
          onChange={(e) => setField("currentPassword", e.target.value)}
          invalid={Boolean(fieldErrors.currentPassword)}
          disabled={submitting}
          required
        />
        {fieldErrors.currentPassword && (
          <FieldError>{fieldErrors.currentPassword}</FieldError>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="newPassword">New password</Label>
          <Input
            id="newPassword"
            type="password"
            autoComplete="new-password"
            value={form.newPassword}
            onChange={(e) => setField("newPassword", e.target.value)}
            invalid={Boolean(fieldErrors.newPassword)}
            disabled={submitting}
            required
          />
          {fieldErrors.newPassword && (
            <FieldError>{fieldErrors.newPassword}</FieldError>
          )}
        </div>
        <div>
          <Label htmlFor="confirmNewPassword">Confirm new password</Label>
          <Input
            id="confirmNewPassword"
            type="password"
            autoComplete="new-password"
            value={form.confirmNewPassword}
            onChange={(e) => setField("confirmNewPassword", e.target.value)}
            invalid={Boolean(fieldErrors.confirmNewPassword)}
            disabled={submitting}
            required
          />
          {fieldErrors.confirmNewPassword && (
            <FieldError>{fieldErrors.confirmNewPassword}</FieldError>
          )}
        </div>
      </div>

      <Button type="submit" disabled={submitting}>
        {submitting ? "Changing…" : "Change password"}
      </Button>
    </form>
  );
}