import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { Card } from "@/components/ui/card";
import { loadRoutingRules } from "@/lib/routing/config";
import { RoutingRulesManager } from "@/components/admin/routing-rules-manager";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";

export const metadata: Metadata = {
  title: "Routing Rules",
};

export default async function AdminRoutingPage() {
  await requireRole(["ADMIN"]);
  const locale = await getLocale();
  const t = copy[locale].admin;

  const [rules, categories, offices] = await Promise.all([
    loadRoutingRules(),
    db.concernCategory.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true },
    }),
    db.office.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t.routingTitle}</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">{t.routingLead}</p>
      </div>

      <Card>
        <RoutingRulesManager
          locale={locale}
          rules={rules.map((rule) => ({
            id: rule.id,
            categoryId: rule.categoryId,
            officeId: rule.officeId,
            priorityOrder: rule.priorityOrder,
            isActive: rule.isActive,
            category: {
              id: rule.category.id,
              name: rule.category.name,
              code: rule.category.code,
            },
            office: {
              id: rule.office.id,
              name: rule.office.name,
              code: rule.office.code,
            },
          }))}
          categories={categories}
          offices={offices}
        />
      </Card>
    </div>
  );
}
