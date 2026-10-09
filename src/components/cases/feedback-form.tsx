"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  FormMessage,
  Label,
  Textarea,
} from "@/components/ui/field";
import { apiRequest } from "@/lib/api-client";
import { copy, type Locale } from "@/lib/i18n";

const selectStyles =
  "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30";

export type FeedbackDraft = {
  wasResolved: boolean;
  rating: number;
  comment: string | null;
};

export function FeedbackForm({
  concernId,
  existing,
  onDone,
  locale = "en",
}: {
  concernId: number;
  existing?: FeedbackDraft | null;
  onDone?: (message: string) => void;
  locale?: Locale;
}) {
  const t = copy[locale].feedback;
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setSuccess(null);

    const data = new FormData(event.currentTarget);
    const comment = String(data.get("comment") ?? "").trim();
    const body = {
      wasResolved: data.get("wasResolved") === "true",
      rating: Number(data.get("rating") ?? 3),
      ...(comment ? { comment } : {}),
    };

    setSubmitting(true);
    const result = await apiRequest<
      { caseNumber: string; created: boolean; rating: number }
    >(`/api/v1/concerns/${concernId}/feedback`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    setSubmitting(false);

    if (!result.success) {
      if (
        result.error.code === "VALIDATION_ERROR" &&
        Array.isArray(result.error.details)
      ) {
        const details = result.error.details as { message: string }[];
        setFormError(details.map((d) => d.message).join(" "));
      } else {
        setFormError(result.error.message);
      }
      return;
    }

    const message = result.data.created ? t.thanks : t.updated;
    setSuccess(message);
    router.refresh();
    onDone?.(message);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {success && <FormMessage tone="success">{success}</FormMessage>}
      {formError && <FormMessage tone="error">{formError}</FormMessage>}

      <div>
        <Label htmlFor="feedback-was-resolved">{t.wasResolved}</Label>
        <select
          id="feedback-was-resolved"
          name="wasResolved"
          defaultValue={existing ? String(existing.wasResolved) : "true"}
          className={selectStyles}
        >
          <option value="true">{t.yes}</option>
          <option value="false">{t.no}</option>
        </select>
      </div>

      <div>
        <Label htmlFor="feedback-rating">{t.rating}</Label>
        <select
          id="feedback-rating"
          name="rating"
          defaultValue={existing?.rating ?? 3}
          className={selectStyles}
        >
          <option value={5}>{t.rating5}</option>
          <option value={4}>{t.rating4}</option>
          <option value={3}>{t.rating3}</option>
          <option value={2}>{t.rating2}</option>
          <option value={1}>{t.rating1}</option>
        </select>
      </div>

      <div>
        <Label htmlFor="feedback-comment">{t.comment}</Label>
        <Textarea
          id="feedback-comment"
          name="comment"
          rows={3}
          maxLength={500}
          defaultValue={existing?.comment ?? ""}
          placeholder={t.commentPlaceholder}
        />
      </div>

      <Button type="submit" disabled={submitting} variant="secondary">
        {submitting ? t.saving : existing ? t.update : t.submit}
      </Button>
    </form>
  );
}