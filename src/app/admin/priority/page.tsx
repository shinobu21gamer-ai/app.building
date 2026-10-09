import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/session";
import { Card } from "@/components/ui/card";
import { PriorityConfigForm } from "@/components/admin/priority-config-form";
import { loadPriorityConfig } from "@/lib/priority/config";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";

export const metadata: Metadata = {
  title: "Priority Rules",
};

export default async function AdminPriorityPage() {
  await requireRole(["ADMIN"]);
  const locale = await getLocale();
  const t = copy[locale].admin;
  const { factors, thresholds } = await loadPriorityConfig();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t.priorityTitle}</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">{t.priorityLead}</p>
      </div>

      <Card>
        <PriorityConfigForm
          locale={locale}
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
