import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { Card } from "@/components/ui/card";
import { loadRoutingRules } from "@/lib/routing/config";
import { RoutingRulesManager } from "@/components/admin/routing-rules-manager";
import { PageHeader } from "@/components/ui/page-header";
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
      <PageHeader title={t.routingTitle} description={t.routingLead} />

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
