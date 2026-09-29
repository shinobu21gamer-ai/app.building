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
  const params = await searchParams;
  const filters = parseNameFilters(params);
  const categories = await listAdminCategories(filters);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">
          Concern categories
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Categories classify resident concerns and drive automatic routing. A
          category that is referenced by any record can be disabled but not
          deleted.
        </p>
      </div>

      <AdminFilterBar
        initialQ={firstParam(params, "q")}
        qPlaceholder="Search by category name or code"
        fields={[
          {
            name: "status",
            label: "Status",
            options: [
              { value: "", label: "All" },
              { value: "active", label: "Active" },
              { value: "disabled", label: "Disabled" },
            ],
          },
        ]}
        initialValues={{ status: firstParam(params, "status") }}
      />

      <Card>
        <CategoryManager categories={categories.map(adminCategoryView)} />
      </Card>
    </div>
  );
}
