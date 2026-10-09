"use client";

import { useState } from "react";
import { trackConcernSchema } from "@/lib/validations/concern";
import { apiRequest } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { FieldError, FormMessage, Input, Label } from "@/components/ui/field";
import { Badge, PriorityBadge, StatusBadge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format";
import { CopyCaseNumber } from "@/components/cases/copy-case-number";
import { copy, type Locale } from "@/lib/i18n";

export type TrackedCase = {
  caseNumber: string;
  title: string;
  status: string;
  statusLabel: string;
  priorityLevel: string | null;
  category: string;
  assignedOffice: string | null;
  submittedAt: string;
  lastUpdatedAt: string;
};

export function TrackCaseForm({
  initialCaseNumber = "",
  locale = "en",
}: {
  initialCaseNumber?: string;
  locale?: Locale;
}) {
  const t = copy[locale].track;
  const [caseNumber, setCaseNumber] = useState(initialCaseNumber);
  const [email, setEmail] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<TrackedCase | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setResult(null);

    const parsed = trackConcernSchema.safeParse({ caseNumber, email });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "");
        if (key && !next[key]) next[key] = issue.message;
      }
      setFieldErrors(next);
      return;
    }

    setFieldErrors({});
    setSubmitting(true);
    const response = await apiRequest<TrackedCase>("/api/v1/concerns/track", {
      method: "POST",
      body: JSON.stringify(parsed.data),
    });
    setSubmitting(false);

    if (!response.success) {
      setError(response.error.message);
      return;
    }

    setResult(response.data);
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {error ? <FormMessage tone="error">{error}</FormMessage> : null}

        <div>
          <Label htmlFor="caseNumber">{t.caseNumber}</Label>
          <Input
            id="caseNumber"
            name="caseNumber"
            value={caseNumber}
            onChange={(event) => setCaseNumber(event.target.value.toUpperCase())}
            placeholder="BR-20261009-0001"
            autoComplete="off"
            spellCheck={false}
            invalid={Boolean(fieldErrors.caseNumber)}
            disabled={submitting}
            required
          />
          {fieldErrors.caseNumber ? (
            <FieldError>{fieldErrors.caseNumber}</FieldError>
          ) : (
            <p className="mt-1 text-xs text-slate-500">
              {t.caseHint}
            </p>
          )}
        </div>

        <div>
          <Label htmlFor="email">{t.email}</Label>
          <Input
            id="email"
            name="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            placeholder="you@example.com"
            invalid={Boolean(fieldErrors.email)}
            disabled={submitting}
            required
          />
          {fieldErrors.email ? (
            <FieldError>{fieldErrors.email}</FieldError>
          ) : (
            <p className="mt-1 text-xs text-slate-500">
              {t.emailHint}
            </p>
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

      {result ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-sm font-semibold text-slate-900">
                {result.caseNumber}
              </p>
              <p className="mt-1 text-base font-semibold text-slate-900">
                {result.title}
              </p>
            </div>
            <CopyCaseNumber caseNumber={result.caseNumber} />
          </div>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {t.status}
              </dt>
              <dd className="mt-1">
                <StatusBadge status={result.status} />
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {t.priority}
              </dt>
              <dd className="mt-1">
                {result.priorityLevel ? (
                  <PriorityBadge level={result.priorityLevel} />
                ) : (
                  <Badge tone="neutral">{t.pending}</Badge>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {t.category}
              </dt>
              <dd className="mt-1 text-slate-800">{result.category}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {t.office}
              </dt>
              <dd className="mt-1 text-slate-800">
                {result.assignedOffice ?? t.unassigned}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {t.submitted}
              </dt>
              <dd className="mt-1 text-slate-800">
                {formatDateTime(result.submittedAt)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {t.updated}
              </dt>
              <dd className="mt-1 text-slate-800">
                {formatDateTime(result.lastUpdatedAt)}
              </dd>
            </div>
          </dl>
          <p className="mt-4 text-xs text-slate-500">
            {t.more}
          </p>
        </div>
      ) : null}
    </div>
  );
}
