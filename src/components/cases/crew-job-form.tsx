"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FormMessage, Label, Textarea } from "@/components/ui/field";
import { apiRequest } from "@/lib/api-client";
import { copy, type Locale } from "@/lib/i18n";

const selectStyles =
  "h-10 w-full rounded-control border border-line-strong bg-surface px-3 text-sm text-ink focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30";

/** A crew member's own progress note; lands on the case journal as CREW_PROGRESS. */
export function CrewJobForm({
  concernId,
  locale = "en",
}: {
  concernId: number;
  locale?: Locale;
}) {
  const t = copy[locale].revamp.workflow;
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    const form = event.currentTarget;
    const data = new FormData(form);
    const payload = {
      kind: String(data.get("kind") ?? "PROGRESS"),
      note: String(data.get("note") ?? ""),
    };

    setSubmitting(true);
    const result = await apiRequest(`/api/v1/crew/jobs/${concernId}`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    setSubmitting(false);

    if (!result.success) {
      setError(result.error.message);
      return;
    }
    form.reset();
    setSuccess(t.jobRecorded);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {success && <FormMessage tone="success">{success}</FormMessage>}
      {error && <FormMessage tone="error">{error}</FormMessage>}

      <div>
        <Label htmlFor={`job-kind-${concernId}`}>{t.jobNote}</Label>
        <select
          id={`job-kind-${concernId}`}
          name="kind"
          defaultValue="PROGRESS"
          className={selectStyles}
        >
          <option value="PROGRESS">{t.jobKindProgress}</option>
          <option value="PROBLEM">{t.jobKindProblem}</option>
          <option value="COMPLETION">{t.jobKindCompletion}</option>
        </select>
      </div>

      <div>
        <Label htmlFor={`job-note-${concernId}`} required>
          {t.jobNote}
        </Label>
        <Textarea
          id={`job-note-${concernId}`}
          name="note"
          rows={2}
          maxLength={500}
          required
          placeholder={t.jobNotePlaceholder}
        />
      </div>

      <Button type="submit" size="sm" disabled={submitting} loading={submitting}>
        {t.jobSubmit}
      </Button>
    </form>
  );
}
