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
}: {
  concernId: number;
  existing?: FeedbackDraft | null;
  onDone?: (message: string) => void;
}) {
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

    const message = result.data.created
      ? "Thank you for your feedback."
      : "Your feedback has been updated.";
    setSuccess(message);
    router.refresh();
    onDone?.(message);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {success && <FormMessage tone="success">{success}</FormMessage>}
      {formError && <FormMessage tone="error">{formError}</FormMessage>}

      <div>
        <Label htmlFor="feedback-was-resolved">Was the concern resolved?</Label>
        <select
          id="feedback-was-resolved"
          name="wasResolved"
          defaultValue={existing ? String(existing.wasResolved) : "true"}
          className={selectStyles}
        >
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      </div>

      <div>
        <Label htmlFor="feedback-rating">Satisfaction rating</Label>
        <select
          id="feedback-rating"
          name="rating"
          defaultValue={existing?.rating ?? 3}
          className={selectStyles}
        >
          <option value={5}>5 — Very satisfied</option>
          <option value={4}>4 — Satisfied</option>
          <option value={3}>3 — Neutral</option>
          <option value={2}>2 — Dissatisfied</option>
          <option value={1}>1 — Very dissatisfied</option>
        </select>
      </div>

      <div>
        <Label htmlFor="feedback-comment">Comment (optional)</Label>
        <Textarea
          id="feedback-comment"
          name="comment"
          rows={3}
          maxLength={500}
          defaultValue={existing?.comment ?? ""}
          placeholder="Anything else you would like the barangay to know?"
        />
      </div>

      <Button type="submit" disabled={submitting} variant="secondary">
        {submitting
          ? "Saving..."
          : existing
            ? "Update feedback"
            : "Submit feedback"}
      </Button>
    </form>
  );
}