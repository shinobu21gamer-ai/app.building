"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  FormMessage,
  Input,
  Label,
  Textarea,
} from "@/components/ui/field";
import { apiRequest } from "@/lib/api-client";

type ThresholdRow = {
  level: string;
  minScore: number;
  maxScore: number;
  label: string;
};

type FactorRow = {
  key: string;
  label: string;
  description: string | null;
  weight: number;
  minScore: number;
  maxScore: number;
  isActive: boolean;
};

export function PriorityConfigForm({
  initialThresholds,
  initialFactors,
}: {
  initialThresholds: ThresholdRow[];
  initialFactors: FactorRow[];
}) {
  const router = useRouter();
  const [thresholds, setThresholds] = useState(initialThresholds);
  const [factors, setFactors] = useState(initialFactors);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function updateThreshold(index: number, patch: Partial<ThresholdRow>) {
    setThresholds((rows) =>
      rows.map((row, i) => (i === index ? { ...row, ...patch } : row))
    );
  }

  function updateFactor(index: number, patch: Partial<FactorRow>) {
    setFactors((rows) =>
      rows.map((row, i) => (i === index ? { ...row, ...patch } : row))
    );
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setSaving(true);

    const result = await apiRequest<unknown>("/api/v1/admin/priority-config", {
      method: "PUT",
      body: JSON.stringify({
        thresholds: thresholds.map((t) => ({
          level: t.level,
          minScore: t.minScore,
          maxScore: t.maxScore,
          label: t.label || null,
        })),
        factors: factors.map((f, index) => ({
          key: f.key,
          label: f.label,
          description: f.description || null,
          weight: f.weight,
          minScore: f.minScore,
          maxScore: f.maxScore,
          displayOrder: index + 1,
          isActive: f.isActive,
        })),
      }),
    });
    setSaving(false);

    if (!result.success) {
      if (
        result.error.code === "VALIDATION_ERROR" &&
        Array.isArray(result.error.details)
      ) {
        const details = result.error.details as { message: string }[];
        setError(details.map((d) => d.message).join(" "));
      } else {
        setError(result.error.message);
      }
      return;
    }

    setSuccess("Priority rules saved. New submissions will use these settings.");
    router.refresh();
  }

  const activeFactors = factors.filter((f) => f.isActive);
  const minPossible = activeFactors.reduce(
    (sum, f) => sum + f.minScore * f.weight,
    0
  );
  const maxPossible = activeFactors.reduce(
    (sum, f) => sum + f.maxScore * f.weight,
    0
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {success && <FormMessage tone="success">{success}</FormMessage>}
      {error && <FormMessage tone="error">{error}</FormMessage>}

      <section>
        <h2 className="text-base font-semibold text-slate-900">
          Scoring factors
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Each factor&apos;s weight multiplies the resident&apos;s rating. With
          the current settings the total score ranges {minPossible}–{maxPossible}.
        </p>
        <div className="mt-4 space-y-3">
          {factors.map((factor, index) => (
            <div
              key={factor.key}
              className={`grid grid-cols-2 items-end gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-6 ${
                factor.isActive ? "" : "bg-slate-50 opacity-75"
              }`}
            >
              <div className="col-span-2 sm:col-span-2">
                <Label htmlFor={`factor-label-${factor.key}`}>Factor</Label>
                <Input
                  id={`factor-label-${factor.key}`}
                  value={factor.label}
                  onChange={(e) =>
                    updateFactor(index, { label: e.target.value })
                  }
                />
              </div>
              <div className="col-span-2 sm:col-span-4">
                <Label htmlFor={`factor-description-${factor.key}`}>
                  Resident-facing description
                </Label>
                <Textarea
                  id={`factor-description-${factor.key}`}
                  value={factor.description ?? ""}
                  onChange={(e) =>
                    updateFactor(index, { description: e.target.value })
                  }
                  rows={2}
                  maxLength={255}
                  placeholder="Shown to residents when submitting a concern."
                />
              </div>
              <div>
                <Label htmlFor={`factor-weight-${factor.key}`}>Weight</Label>
                <Input
                  id={`factor-weight-${factor.key}`}
                  type="number"
                  min={1}
                  max={100}
                  value={factor.weight}
                  onChange={(e) =>
                    updateFactor(index, { weight: Number(e.target.value) })
                  }
                />
              </div>
              <div>
                <Label htmlFor={`factor-min-${factor.key}`}>Min score</Label>
                <Input
                  id={`factor-min-${factor.key}`}
                  type="number"
                  min={0}
                  max={1000}
                  value={factor.minScore}
                  onChange={(e) =>
                    updateFactor(index, { minScore: Number(e.target.value) })
                  }
                />
              </div>
              <div>
                <Label htmlFor={`factor-max-${factor.key}`}>Max score</Label>
                <Input
                  id={`factor-max-${factor.key}`}
                  type="number"
                  min={0}
                  max={1000}
                  value={factor.maxScore}
                  onChange={(e) =>
                    updateFactor(index, { maxScore: Number(e.target.value) })
                  }
                />
              </div>
              <div>
                <Label htmlFor={`factor-active-${factor.key}`}>Active</Label>
                <label className="flex h-10 items-center gap-2 text-sm text-slate-700">
                  <input
                    id={`factor-active-${factor.key}`}
                    type="checkbox"
                    checked={factor.isActive}
                    onChange={(e) =>
                      updateFactor(index, { isActive: e.target.checked })
                    }
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  Used
                </label>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-base font-semibold text-slate-900">
          Priority thresholds
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Thresholds must be contiguous and cover the full range{" "}
          {minPossible}–{maxPossible}.
        </p>
        <div className="mt-4 space-y-3">
          {thresholds.map((threshold, index) => (
            <div
              key={threshold.level}
              className="grid grid-cols-2 items-end gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-4"
            >
              <div>
                <Label htmlFor={`threshold-level-${threshold.level}`}>
                  Level
                </Label>
                <Input
                  id={`threshold-level-${threshold.level}`}
                  value={threshold.level}
                  disabled
                />
              </div>
              <div>
                <Label htmlFor={`threshold-label-${threshold.level}`}>
                  Display label
                </Label>
                <Input
                  id={`threshold-label-${threshold.level}`}
                  value={threshold.label}
                  onChange={(e) =>
                    updateThreshold(index, { label: e.target.value })
                  }
                />
              </div>
              <div>
                <Label htmlFor={`threshold-min-${threshold.level}`}>
                  Min score
                </Label>
                <Input
                  id={`threshold-min-${threshold.level}`}
                  type="number"
                  min={0}
                  max={10000}
                  value={threshold.minScore}
                  onChange={(e) =>
                    updateThreshold(index, { minScore: Number(e.target.value) })
                  }
                />
              </div>
              <div>
                <Label htmlFor={`threshold-max-${threshold.level}`}>
                  Max score
                </Label>
                <Input
                  id={`threshold-max-${threshold.level}`}
                  type="number"
                  min={0}
                  max={10000}
                  value={threshold.maxScore}
                  onChange={(e) =>
                    updateThreshold(index, { maxScore: Number(e.target.value) })
                  }
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      <Button type="submit" disabled={saving}>
        {saving ? "Saving..." : "Save priority rules"}
      </Button>
    </form>
  );
}
