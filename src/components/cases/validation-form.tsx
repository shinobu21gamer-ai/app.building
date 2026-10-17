"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FormMessage, Label, RequiredLegend, Textarea } from "@/components/ui/field";
import { apiRequest } from "@/lib/api-client";
import { copy, type Locale } from "@/lib/i18n";

const selectStyles =
  "h-10 w-full rounded-control border border-line-strong bg-surface px-3 text-sm text-ink focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30";

const PRIORITY_LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

export type ValidationOption = {
  id: number;
  label: string;
  typeId?: number | null;
};

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
  currentTypeLabel,
  currentCategoryLabel,
  currentPriority,
}: {
  concernId: number;
  locale?: Locale;
  types: ValidationOption[];
  categories: ValidationOption[];
  currentTypeLabel: string | null;
  currentCategoryLabel: string;
  currentPriority: string | null;
}) {
  const t = copy[locale].revamp.workflow;
  const router = useRouter();
  const [selectedTypeId, setSelectedTypeId] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Only the categories connected to the chosen service type are offered:
  // picking "Repair / Public Works" must never list a health category. A
  // category with no service type yet stays hidden here until an admin
  // connects it to one under Categories — it is not a wildcard.
  const visibleCategories = categories.filter(
    (category) =>
      category.typeId != null && String(category.typeId) === selectedTypeId
  );
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
      <RequiredLegend>{copy[locale].revamp.requiredLegend}</RequiredLegend>

      <div>
        <Label htmlFor="validation-type" required>
          {t.validationType}
        </Label>
        {currentTypeLabel ? (
          <p className="mb-1 text-xs text-ink-subtle">
            {t.validationCurrentValue.replace("{value}", currentTypeLabel)}
          </p>
        ) : null}
        <p className="mb-1 text-xs text-ink-subtle">{t.validationTypeHint}</p>
        <select
          id="validation-type"
          name="typeId"
          required
          value={selectedTypeId}
          onChange={(event) => {
            setSelectedTypeId(event.target.value);
            setSelectedCategoryId("");
          }}
          className={selectStyles}
        >
          <option value="" disabled>
            {t.validationTypePlaceholder}
          </option>
          {types.map((type) => (
            <option key={type.id} value={type.id}>
              {type.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <Label htmlFor="validation-category" required>
          {t.validationCategory}
        </Label>
        <p className="mb-1 text-xs text-ink-subtle">
          {t.validationCurrentValue.replace("{value}", currentCategoryLabel)}
        </p>
        <p className="mb-1 text-xs text-ink-subtle">{t.validationCategoryHint}</p>
        <select
          id="validation-category"
          name="categoryId"
          required
          value={selectedCategoryId}
          onChange={(event) => setSelectedCategoryId(event.target.value)}
          disabled={selectedTypeId === "" || visibleCategories.length === 0}
          className={selectStyles}
        >
          <option value="" disabled>
            {t.validationCategoryPlaceholder}
          </option>
          {visibleCategories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.label}
            </option>
          ))}
        </select>
        {selectedTypeId !== "" && visibleCategories.length === 0 ? (
          <p role="alert" className="mt-1 text-sm text-red-700">
            {t.validationNoCategories}
          </p>
        ) : null}
      </div>

      <div>
        <Label htmlFor="validation-priority" optional>
          {t.validationPriority}
        </Label>
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
