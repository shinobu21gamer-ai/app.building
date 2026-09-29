"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import { FeedbackForm } from "./feedback-form";

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
}: {
  concernId: number;
  existing?: FeedbackView | null;
  resubmissionAllowed: boolean;
}) {
  const [showForm, setShowForm] = useState(!existing);

  if (existing && !resubmissionAllowed) {
    return (
      <div className="space-y-1 text-sm text-slate-600">
        <p>
          You rated this case <span className="font-semibold">{existing.rating}/5</span>
          {" · "}Resolved:{" "}
          <span className="font-semibold">
            {existing.wasResolved ? "Yes" : "No"}
          </span>
        </p>
        {existing.comment && (
          <p className="text-slate-500">“{existing.comment}”</p>
        )}
        <p className="text-xs text-slate-400">
          Submitted {formatDateTime(existing.updatedAt)}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {existing && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-slate-600">
            Current feedback: {existing.rating}/5
          </p>
          {!showForm && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowForm(true)}
            >
              Update feedback
            </Button>
          )}
        </div>
      )}
      {showForm && (
        <FeedbackForm
          concernId={concernId}
          existing={existing}
          onDone={() => setShowForm(false)}
        />
      )}
      {existing && showForm && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setShowForm(false)}
        >
          Cancel
        </Button>
      )}
    </div>
  );
}