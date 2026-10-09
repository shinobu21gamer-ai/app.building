import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/session";
import { Card } from "@/components/ui/card";
import { AdminFilterBar } from "@/components/admin/admin-filter-bar";
import { CategoryManager } from "@/components/admin/category-manager";
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t.categoriesTitle}</h1>
        <p className="mt-1 text-sm text-slate-600">{t.categoriesLead}</p>
      </div>

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
          locale={locale}
        />
      </Card>
    </div>
  );
}
