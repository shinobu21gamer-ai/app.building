"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormMessage, Input, Label, Textarea } from "@/components/ui/field";
import { apiRequest } from "@/lib/api-client";
import { createAlertSchema } from "@/lib/validations/alert";

type Severity = "INFO" | "WARNING" | "CRITICAL";

const TITLE_MIN = 3;
const TITLE_MAX = 120;
const MESSAGE_MIN = 5;
const MESSAGE_MAX = 2000;

function zodFieldErrors(details: unknown): Record<string, string> {
  if (!Array.isArray(details)) return {};
  const out: Record<string, string> = {};
  for (const item of details) {
    if (typeof item !== "object" || item === null) continue;
    const entry = item as { path?: unknown; message?: unknown };
    if (typeof entry.path === "string" && typeof entry.message === "string") {
      out[entry.path] = entry.message;
    }
  }
  return out;
}

export function AlertComposer() {
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [severity, setSeverity] = useState<Severity>("INFO");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFeedback(null);
    setError(null);
    setFieldErrors({});

    const parsed = createAlertSchema.safeParse({
      title,
      message,
      severity,
      sound: true,
    });

    if (!parsed.success) {
      const errors = zodFieldErrors(parsed.error.flatten().fieldErrors);
      setFieldErrors(errors);
      setError("Please fix the highlighted fields before publishing.");
      setBusy(false);
      return;
    }

    const result = await apiRequest<{ alert: { id: number } }>("/api/v1/alerts", {
      method: "POST",
      body: JSON.stringify(parsed.data),
    });

    setBusy(false);

    if (!result.success) {
      const serverFieldErrors = zodFieldErrors(result.error.details);
      if (Object.keys(serverFieldErrors).length > 0) {
        setFieldErrors(serverFieldErrors);
      }
      setError(result.error.message);
      return;
    }

    setTitle("");
    setMessage("");
    setSeverity("INFO");
    setFeedback("Alert published to all active users.");
  }

  const titleError = fieldErrors.title;
  const messageError = fieldErrors.message;
  const severityError = fieldErrors.severity;
  const titleTooShort = title.trim().length > 0 && title.trim().length < TITLE_MIN;
  const messageTooShort = message.trim().length > 0 && message.trim().length < MESSAGE_MIN;

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/50 p-4" noValidate>
      <div>
        <h2 className="font-semibold text-slate-900">Broadcast alert</h2>
        <p className="mt-1 text-xs text-slate-600">Users must acknowledge the alert before it closes.</p>
      </div>

      {feedback && <FormMessage tone="success">{feedback}</FormMessage>}
      {error && <FormMessage tone="error">{error}</FormMessage>}

      <div>
        <Label htmlFor="alert-title">Title</Label>
        <Input
          id="alert-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          minLength={TITLE_MIN}
          maxLength={TITLE_MAX}
          required
          aria-invalid={Boolean(titleError)}
          aria-describedby={titleError ? "alert-title-error" : undefined}
        />
        <p className="mt-1 text-xs text-slate-500">
          {TITLE_MIN}–{TITLE_MAX} characters. {title.trim().length}/{TITLE_MAX}
        </p>
        {titleError && (
          <p id="alert-title-error" className="mt-1 text-xs font-medium text-red-600">
            {titleError}
          </p>
        )}
        {!titleError && titleTooShort && (
          <p className="mt-1 text-xs font-medium text-red-600">
            Title must be at least {TITLE_MIN} characters.
          </p>
        )}
      </div>

      <div>
        <Label htmlFor="alert-message">What is happening?</Label>
        <Textarea
          id="alert-message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          minLength={MESSAGE_MIN}
          maxLength={MESSAGE_MAX}
          rows={3}
          required
          aria-invalid={Boolean(messageError)}
          aria-describedby={messageError ? "alert-message-error" : undefined}
        />
        <p className="mt-1 text-xs text-slate-500">
          {MESSAGE_MIN}–{MESSAGE_MAX} characters. {message.trim().length}/{MESSAGE_MAX}
        </p>
        {messageError && (
          <p id="alert-message-error" className="mt-1 text-xs font-medium text-red-600">
            {messageError}
          </p>
        )}
        {!messageError && messageTooShort && (
          <p className="mt-1 text-xs font-medium text-red-600">
            Message must be at least {MESSAGE_MIN} characters.
          </p>
        )}
      </div>

      <div>
        <Label htmlFor="alert-severity">Severity</Label>
        <select
          id="alert-severity"
          value={severity}
          onChange={(event) => setSeverity(event.target.value as Severity)}
          className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
          aria-invalid={Boolean(severityError)}
        >
          <option value="INFO">Information</option>
          <option value="WARNING">Warning</option>
          <option value="CRITICAL">Critical</option>
        </select>
        {severityError && <p className="mt-1 text-xs font-medium text-red-600">{severityError}</p>}
        <p className="mt-1 text-xs text-slate-500">
          {severity === "CRITICAL"
            ? "Loud looping alarm on the phone and lockscreen."
            : severity === "WARNING"
              ? "Repeating alert tone on the phone and lockscreen."
              : "Single short chime."}
        </p>
      </div>

      <Button type="submit" disabled={busy}>
        {busy ? "Publishing..." : "Alert all users"}
      </Button>
    </form>
  );
}
