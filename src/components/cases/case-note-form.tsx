"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  FieldError,
  FormMessage,
  Label,
  Textarea,
} from "@/components/ui/field";
import { apiRequest } from "@/lib/api-client";

const selectStyles =
  "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30";

export function CaseNoteForm({
  concernId,
  disabled,
}: {
  concernId: number;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [remarksError, setRemarksError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (disabled) {
    return (
      <p className="text-sm text-slate-500">
        Closed cases cannot be modified.
      </p>
    );
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setRemarksError(null);
    setSuccess(null);

    const form = event.currentTarget;
    const data = new FormData(form);
    const kind = String(data.get("kind") ?? "REMARK");
    const remarks = String(data.get("remarks") ?? "").trim();
    if (remarks.length < 5) {
      setRemarksError("Provide at least 5 characters.");
      return;
    }

    setSubmitting(true);
    const result = await apiRequest<{ kind: string }>(
      `/api/v1/concerns/${concernId}/notes`,
      {
        method: "POST",
        body: JSON.stringify({ kind, remarks }),
      }
    );
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

    setSuccess(
      kind === "ACTION" ? "Action recorded." : "Progress remark added."
    );
    form.reset();
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {success && <FormMessage tone="success">{success}</FormMessage>}
      {formError && <FormMessage tone="error">{formError}</FormMessage>}

      <div>
        <Label htmlFor="note-kind">Entry type</Label>
        <select
          id="note-kind"
          name="kind"
          defaultValue="REMARK"
          className={selectStyles}
        >
          <option value="REMARK">Progress remark</option>
          <option value="ACTION">Action taken</option>
        </select>
      </div>

      <div>
        <Label htmlFor="note-remarks">Details</Label>
        <Textarea
          id="note-remarks"
          name="remarks"
          rows={3}
          maxLength={1000}
          placeholder="Add an update, observation, or action performed."
          invalid={Boolean(remarksError)}
        />
        {remarksError && <FieldError>{remarksError}</FieldError>}
      </div>

      <Button type="submit" disabled={submitting} variant="secondary">
        {submitting ? "Saving..." : "Add entry"}
      </Button>
    </form>
  );
}
