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
  "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30";

export function PriorityOverrideForm({
  concernId,
  factors,
  levels,
  defaultScores,
  currentLevel,
}: {
  concernId: number;
  factors: OverrideFactor[];
  levels: string[];
  defaultScores: Record<ScoreKey, number>;
  currentLevel: string | null;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setReasonError(null);
    setSuccess(null);

    const data = new FormData(event.currentTarget);
    const reason = String(data.get("reason") ?? "").trim();
    if (reason.length < 5) {
      setReasonError("Provide a reason for the override (at least 5 characters).");
      return;
    }

    const levelOverride = String(data.get("levelOverride") ?? "").trim();
    const body: Record<string, unknown> = {
      reason,
      urgencyScore: Number(data.get("urgencyScore")),
      impactScore: Number(data.get("impactScore")),
      affectedPopulationScore: Number(data.get("affectedPopulationScore")),
      safetyScore: Number(data.get("safetyScore")),
    };
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
      `Priority override saved. New level: ${result.data.assessment.level} (score ${result.data.assessment.totalScore}).`
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
        <Label htmlFor="levelOverride">Priority level override</Label>
        <select
          id="levelOverride"
          name="levelOverride"
          defaultValue=""
          className={selectStyles}
        >
          <option value="">Use the computed recommendation</option>
          {levels.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-slate-500">
          Current level: {currentLevel ?? "not assessed"}. Selecting a level
          overrides the computed result and is recorded for audit.
        </p>
      </div>

      <div>
        <Label htmlFor="reason">Reason for override</Label>
        <Textarea
          id="reason"
          name="reason"
          rows={3}
          maxLength={500}
          placeholder="Explain why the automated recommendation is being changed."
          invalid={Boolean(reasonError)}
        />
        {reasonError && <FieldError>{reasonError}</FieldError>}
      </div>

      <Button type="submit" disabled={submitting}>
        {submitting ? "Saving..." : "Save override"}
      </Button>
    </form>
  );
}
