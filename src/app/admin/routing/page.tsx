import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { Card } from "@/components/ui/card";
import { loadRoutingRules } from "@/lib/routing/config";
import { RoutingRulesManager } from "@/components/admin/routing-rules-manager";

export const metadata: Metadata = {
  title: "Routing Rules",
};

export default async function AdminRoutingPage() {
  await requireRole(["ADMIN"]);

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
        <h1 className="text-2xl font-bold text-slate-900">
          Concern Routing Configuration
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">
          Routing is fully database-driven: when a resident submits a concern,
          the system selects the active rule with the lowest priority order for
          that category and assigns it to the rule&apos;s office. If no active
          rule matches, the concern stays unassigned and administrators are
          notified so it can be routed manually. No office assignment is
          hard-coded in the interface.
        </p>
      </div>

      <Card>
        <RoutingRulesManager
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
