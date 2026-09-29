"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/field";
import { apiRequest } from "@/lib/api-client";

export function FeedbackSettingsForm({
  feedbackResubmissionAllowed,
}: {
  feedbackResubmissionAllowed: boolean;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(feedbackResubmissionAllowed);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{
    tone: "error" | "success";
    text: string;
  } | null>(null);

  async function save() {
    setMessage(null);
    setSubmitting(true);
    const result = await apiRequest<{ setting: { key: string; value: string } }>(
      "/api/v1/admin/settings",
      {
        method: "PUT",
        body: JSON.stringify({
          key: "feedback.resubmission_allowed",
          value: String(enabled),
        }),
      }
    );
    setSubmitting(false);

    if (!result.success) {
      setMessage({ tone: "error", text: result.error.message });
      return;
    }
    setMessage({
      tone: "success",
      text: enabled
        ? "Residents may now revise their feedback after submitting it."
        : "Each resident may now submit feedback only once per case.",
    });
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
          className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-700 focus:ring-brand-600"
        />
        <span className="text-sm text-slate-700">
          Allow residents to revise or re-submit feedback after they have
          already rated a case.
        </span>
      </label>
      <p className="text-xs text-slate-500">
        When disabled (default), only one feedback submission per case is
        accepted and duplicates are rejected.
      </p>
      {message && <FormMessage tone={message.tone}>{message.text}</FormMessage>}
      <Button type="button" size="sm" disabled={submitting} onClick={save}>
        {submitting ? "Saving..." : "Save setting"}
      </Button>
    </div>
  );
}