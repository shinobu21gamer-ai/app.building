import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { Card } from "@/components/ui/card";
import { AdminFilterBar } from "@/components/admin/admin-filter-bar";
import { CategoryManager } from "@/components/admin/category-manager";
import { PageHeader } from "@/components/ui/page-header";
import {
  adminCategoryView,
  listAdminCategories,
  parseNameFilters,
} from "@/lib/admin/query";
import { firstParam } from "@/lib/utils";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";

export const metadata: Metadata = {
  title: "Concern categories",
};

type SearchParams = Record<string, string | string[] | undefined>;

export default async function AdminCategoriesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireRole(["ADMIN"]);
  const locale = await getLocale();
  const t = copy[locale].admin;
  const params = await searchParams;
  const filters = parseNameFilters(params);
  const categories = await listAdminCategories(filters);
  // Service types a category can be connected to; only connected categories
  // are offered for that type when a case is validated.
  const types = await db.concernType.findMany({
    where: { isActive: true },
    orderBy: { displayOrder: "asc" },
    select: { id: true, name: true },
  });

  return (
    <div className="space-y-6">
      <PageHeader title={t.categoriesTitle} description={t.categoriesLead} />

      <AdminFilterBar
        locale={locale}
        initialQ={firstParam(params, "q")}
        qPlaceholder={t.categoriesSearch}
        fields={[
          {
            name: "status",
            label: t.filterStatus,
            options: [
              { value: "", label: t.filterAll },
              { value: "active", label: t.filterActive },
              { value: "disabled", label: t.filterDisabled },
            ],
          },
        ]}
        initialValues={{ status: firstParam(params, "status") }}
      />

      <Card>
        <CategoryManager
          categories={categories.map(adminCategoryView)}
          types={types.map((type: { id: number; name: string }) => ({
            id: type.id,
            label: type.name,
          }))}
          locale={locale}
        />
      </Card>
    </div>
  );
}
