"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/field";
import { formatDateTime } from "@/lib/format";
import { FeedbackForm } from "./feedback-form";
import { copy, type Locale } from "@/lib/i18n";

export type FeedbackView = {
  wasResolved: boolean;
  rating: number;
  comment: string | null;
  updatedAt: string;
};

export function FeedbackCard({
  concernId,
  existing,
  resubmissionAllowed,
  locale = "en",
}: {
  concernId: number;
  existing?: FeedbackView | null;
  resubmissionAllowed: boolean;
  locale?: Locale;
}) {
  const t = copy[locale].feedback;
  const [showForm, setShowForm] = useState(!existing);
  const [notice, setNotice] = useState<string | null>(null);

  if (existing && !resubmissionAllowed) {
    return (
      <div className="space-y-3">
        {notice && <FormMessage tone="success">{notice}</FormMessage>}
        <div className="space-y-1 text-sm text-slate-600">
          <p>
            {t.youRated}{" "}
            <span className="font-semibold">{existing.rating}/5</span>
            {" · "}
            {t.resolved}:{" "}
            <span className="font-semibold">
              {existing.wasResolved ? t.yes : t.no}
            </span>
          </p>
          {existing.comment && (
            <p className="text-slate-500">“{existing.comment}”</p>
          )}
          <p className="text-xs text-slate-400">
            {t.submitted.replace("{date}", formatDateTime(existing.updatedAt))}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {notice && <FormMessage tone="success">{notice}</FormMessage>}
      {existing && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-slate-600">
            {t.current.replace("{rating}", String(existing.rating))}
          </p>
          {!showForm && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowForm(true)}
            >
              {t.update}
            </Button>
          )}
        </div>
      )}
      {showForm && (
        <FeedbackForm
          concernId={concernId}
          existing={existing}
          locale={locale}
          onDone={(message) => {
            setNotice(message);
            setShowForm(false);
          }}
        />
      )}
      {existing && showForm && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setShowForm(false)}
        >
          {t.cancel}
        </Button>
      )}
    </div>
  );
}