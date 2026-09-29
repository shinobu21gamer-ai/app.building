import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/session";
import { Card } from "@/components/ui/card";
import { PriorityConfigForm } from "@/components/admin/priority-config-form";
import { loadPriorityConfig } from "@/lib/priority/config";

export const metadata: Metadata = {
  title: "Priority Rules",
};

export default async function AdminPriorityPage() {
  await requireRole(["ADMIN"]);
  const { factors, thresholds } = await loadPriorityConfig();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">
          Priority Rule Configuration
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">
          BarangayResolve uses a transparent rule-based engine: each concern
          factor is rated, multiplied by its configured weight, summed into a
          total score, and mapped to a priority level by the thresholds below.
          Changes affect new submissions; existing assessments keep the values
          they were computed with.
        </p>
      </div>

      <Card>
        <PriorityConfigForm
          initialThresholds={thresholds.map((t) => ({
            level: t.level,
            minScore: t.minScore,
            maxScore: t.maxScore,
            label: t.label ?? "",
          }))}
          initialFactors={factors.map((f) => ({
            key: f.key,
            label: f.label,
            description: f.description ?? null,
            weight: f.weight,
            minScore: f.minScore,
            maxScore: f.maxScore,
            isActive: f.isActive !== false,
          }))}
        />
      </Card>
    </div>
  );
}
