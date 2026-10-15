"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  FieldError,
  FormMessage,
  Input,
  Label,
  Textarea,
} from "@/components/ui/field";
import { apiRequest } from "@/lib/api-client";
import {
  MAX_AFFECTED_PEOPLE,
  describeAffectedPeople,
} from "@/lib/priority/affected";
import { copy, type Locale } from "@/lib/i18n";

export type OverrideFactor = {
  key: string;
  label: string;
  minScore: number;
  maxScore: number;
  weight: number;
};

type ScoreKey =
  | "urgencyScore"
  | "impactScore"
  | "affectedPopulationScore"
  | "safetyScore";

const FACTOR_FIELD: Record<string, ScoreKey> = {
  URGENCY: "urgencyScore",
  IMPACT: "impactScore",
  AFFECTED_POPULATION: "affectedPopulationScore",
  SAFETY: "safetyScore",
};

const selectStyles =
  "h-10 w-full rounded-control border border-line-strong bg-surface px-3 text-sm text-ink focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30";

export function PriorityOverrideForm({
  concernId,
  factors,
  levels,
  defaultScores,
  defaultAffectedPeople = null,
  currentLevel,
  locale = "en",
}: {
  concernId: number;
  factors: OverrideFactor[];
  levels: string[];
  defaultScores: Record<ScoreKey, number>;
  /** The headcount the last assessment recorded, if any. */
  defaultAffectedPeople?: number | null;
  currentLevel: string | null;
  locale?: Locale;
}) {
  const t = copy[locale].desk;
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // The affected-population factor is answered as a headcount, not as a 1–5
  // pick: "how many people does this affect?" is a number the official knows,
  // and the band it scores in is computed from it.
  const [affectedPeople, setAffectedPeople] = useState(
    defaultAffectedPeople ? String(defaultAffectedPeople) : ""
  );
  const [affectedError, setAffectedError] = useState<string | null>(null);
  const populationFactor = factors.find((f) => f.key === "AFFECTED_POPULATION");
  const affectedHint = (() => {
    const count = Number(affectedPeople);
    if (!affectedPeople.trim() || !Number.isFinite(count) || count < 1) return null;
    return describeAffectedPeople(count);
  })();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setReasonError(null);
    setSuccess(null);

    const data = new FormData(event.currentTarget);
    const reason = String(data.get("reason") ?? "").trim();
    if (reason.length < 5) {
      setReasonError(t.overrideReasonError);
      return;
    }

    // The headcount is optional: leaving it blank keeps the score the system
    // computed. A value that is typed, though, has to be a real headcount — a
    // blank answer is a decision, "0" or "+8" is a typo.
    const rawAffected = affectedPeople.trim();
    if (populationFactor && rawAffected) {
      const count = Number(rawAffected);
      if (
        !Number.isInteger(count) ||
        count < 1 ||
        count > MAX_AFFECTED_PEOPLE
      ) {
        setAffectedError(t.affectedPeopleError);
        return;
      }
      setAffectedError(null);
    }

    const levelOverride = String(data.get("levelOverride") ?? "").trim();
    const body: Record<string, unknown> = {
      reason,
      urgencyScore: Number(data.get("urgencyScore")),
      impactScore: Number(data.get("impactScore")),
      safetyScore: Number(data.get("safetyScore")),
    };
    if (populationFactor && rawAffected) body.affectedPeople = Number(rawAffected);
    if (levelOverride) body.levelOverride = levelOverride;

    setSubmitting(true);
    const result = await apiRequest<{
      assessment: { level: string; totalScore: number };
      explanation: string[];
    }>(`/api/v1/concerns/${concernId}/priority`, {
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

    setSuccess(
      t.overrideSaved
        .replace("{level}", result.data.assessment.level)
        .replace("{score}", String(result.data.assessment.totalScore))
    );
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {success && <FormMessage tone="success">{success}</FormMessage>}
      {formError && <FormMessage tone="error">{formError}</FormMessage>}

      <div className="grid gap-4 sm:grid-cols-2">
        {factors.map((factor) => {
          const field = FACTOR_FIELD[factor.key];
          if (field === "affectedPopulationScore") {
            return (
              <div key={factor.key}>
                <Label htmlFor="affectedPeople">{t.affectedPeopleLabel}</Label>
                <Input
                  id="affectedPeople"
                  name="affectedPeople"
                  type="number"
                  min={1}
                  max={MAX_AFFECTED_PEOPLE}
                  step={1}
                  inputMode="numeric"
                  value={affectedPeople}
                  onChange={(event) => {
                    setAffectedPeople(event.target.value);
                    setAffectedError(null);
                  }}
                  invalid={Boolean(affectedError)}
                  aria-describedby="override-affected-hint"
                />
                {affectedError ? (
                  <FieldError id="override-affected-hint">{affectedError}</FieldError>
                ) : (
                  <p id="override-affected-hint" className="mt-1 text-xs text-ink-subtle">
                    {affectedHint ?? t.affectedPeopleHint}
                  </p>
                )}
              </div>
            );
          }
          const options: number[] = [];
          for (let v = factor.minScore; v <= factor.maxScore; v += 1) {
            options.push(v);
          }
          return (
            <div key={factor.key}>
              <Label htmlFor={`override-${field}`}>{factor.label}</Label>
              <select
                id={`override-${field}`}
                name={field}
                defaultValue={String(defaultScores[field] ?? factor.minScore)}
                className={selectStyles}
              >
                {options.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>

      <div>
        <Label htmlFor="levelOverride">{t.levelOverride}</Label>
        <select
          id="levelOverride"
          name="levelOverride"
          defaultValue=""
          className={selectStyles}
        >
          <option value="">{t.useComputed}</option>
          {levels.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-ink-subtle">
          {t.currentLevel.replace(
            "{level}",
            currentLevel ?? t.notAssessedLevel
          )}
        </p>
      </div>

      <div>
        <Label htmlFor="reason" required>{t.overrideReason}</Label>
        <Textarea
          id="reason"
          name="reason"
          rows={3}
          maxLength={500}
          placeholder={t.overrideReasonPlaceholder}
          invalid={Boolean(reasonError)}
          aria-describedby={reasonError ? "reason-error" : undefined}
        />
        {reasonError && <FieldError id="reason-error">{reasonError}</FieldError>}
      </div>

      <Button type="submit" disabled={submitting}>
        {submitting ? t.saving : t.saveOverride}
      </Button>
    </form>
  );
}
