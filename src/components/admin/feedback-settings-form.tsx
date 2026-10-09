"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/field";
import { apiRequest } from "@/lib/api-client";
import { copy, type Locale } from "@/lib/i18n";

export function FeedbackSettingsForm({
  feedbackResubmissionAllowed,
  locale = "en",
}: {
  feedbackResubmissionAllowed: boolean;
  locale?: Locale;
}) {
  const t = copy[locale].admin.mgr;
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
      text: enabled ? t.feedbackOn : t.feedbackOff,
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
        <span className="text-sm text-slate-700">{t.feedbackAllow}</span>
      </label>
      <p className="text-xs text-slate-500">{t.feedbackHint}</p>
      {message && <FormMessage tone={message.tone}>{message.text}</FormMessage>}
      <Button type="button" size="sm" disabled={submitting} onClick={save}>
        {submitting ? t.saving : t.saveSetting}
      </Button>
    </div>
  );
}
