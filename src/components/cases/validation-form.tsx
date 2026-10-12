"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FormMessage, Label, Textarea } from "@/components/ui/field";
import { apiRequest } from "@/lib/api-client";
import { copy, type Locale } from "@/lib/i18n";

const selectStyles =
  "h-10 w-full rounded-control border border-line-strong bg-surface px-3 text-sm text-ink focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30";

const PRIORITY_LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

export type ValidationOption = { id: number; label: string };

/**
 * Admin validation: confirm the concern is real, set the service type and the
 * category, confirm the priority that will be shown publicly, and route it to
 * the office the type belongs to.
 */
export function ValidationForm({
  concernId,
  locale = "en",
  types,
  categories,
  currentTypeId,
  currentCategoryId,
  currentPriority,
}: {
  concernId: number;
  locale?: Locale;
  types: ValidationOption[];
  categories: ValidationOption[];
  currentTypeId: number | null;
  currentCategoryId: number | null;
  currentPriority: string | null;
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

    const data = new FormData(event.currentTarget);
    const payload = {
      typeId: Number(data.get("typeId") ?? 0),
      categoryId: Number(data.get("categoryId") ?? 0) || undefined,
      priorityLevel: String(data.get("priorityLevel") ?? ""),
      notes: String(data.get("notes") ?? ""),
      confirmPriority: data.get("confirmPriority") === "on",
    };

    setSubmitting(true);
    const result = await apiRequest<{ caseNumber: string; typeKey: string; routedOfficeName: string | null }>(
      `/api/v1/concerns/${concernId}/validation`,
      { method: "POST", body: JSON.stringify(payload) }
    );
    setSubmitting(false);

    if (!result.success) {
      setError(result.error.message);
      return;
    }
    setSuccess(
      `${t.validationSaved} ${result.data.typeKey}` +
        (result.data.routedOfficeName ? ` → ${result.data.routedOfficeName}` : "")
    );
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {success && <FormMessage tone="success">{success}</FormMessage>}
      {error && <FormMessage tone="error">{error}</FormMessage>}

      <div>
        <Label htmlFor="validation-type" required>
          {t.validationType}
        </Label>
        <select
          id="validation-type"
          name="typeId"
          required
          defaultValue={currentTypeId ? String(currentTypeId) : ""}
          className={selectStyles}
        >
          <option value="" disabled>
            {t.validationAwaitingType}
          </option>
          {types.map((type) => (
            <option key={type.id} value={type.id}>
              {type.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <Label htmlFor="validation-category">{t.validationCategory}</Label>
        <select
          id="validation-category"
          name="categoryId"
          defaultValue={currentCategoryId ? String(currentCategoryId) : ""}
          className={selectStyles}
        >
          <option value="">—</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <Label htmlFor="validation-priority">{t.validationPriority}</Label>
        <select
          id="validation-priority"
          name="priorityLevel"
          defaultValue={currentPriority ?? ""}
          className={selectStyles}
        >
          <option value="">—</option>
          {PRIORITY_LEVELS.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>
      </div>

      <div>
        <Label htmlFor="validation-notes" required>
          {t.validationNotes}
        </Label>
        <Textarea
          id="validation-notes"
          name="notes"
          rows={3}
          maxLength={1000}
          required
        />
      </div>

      <label className="flex items-start gap-2 text-sm text-ink-muted">
        <input
          type="checkbox"
          name="confirmPriority"
          className="mt-0.5 h-4 w-4 rounded border-line-strong"
        />
        <span>{t.validationConfirmPriority}</span>
      </label>

      <Button type="submit" disabled={submitting} loading={submitting}>
        {t.validationSubmit}
      </Button>
    </form>
  );
}
