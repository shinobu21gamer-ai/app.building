import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { Card } from "@/components/ui/card";
import { AdminFilterBar } from "@/components/admin/admin-filter-bar";
import { UserManager } from "@/components/admin/user-manager";
import {
  adminUserView,
  listAdminUsers,
  parseUserFilters,
} from "@/lib/admin/query";
import { firstParam } from "@/lib/utils";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";

export const metadata: Metadata = {
  title: "Officials",
};

type SearchParams = Record<string, string | string[] | undefined>;

export default async function AdminOfficialsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const actor = await requireRole(["ADMIN"]);
  const locale = await getLocale();
  const t = copy[locale].admin;
  const params = await searchParams;
  const filters = parseUserFilters(params);

  const [officials, offices] = await Promise.all([
    listAdminUsers({ ...filters, role: "OFFICIAL" }),
    db.office.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t.officialsTitle}</h1>
        <p className="mt-1 text-sm text-slate-600">{t.officialsLead}</p>
      </div>

      <AdminFilterBar
        locale={locale}
        initialQ={firstParam(params, "q")}
        qPlaceholder={t.officialsSearch}
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
        <UserManager
          users={officials.map(adminUserView)}
          roles={[{ id: 0, key: "OFFICIAL", name: "Official" }]}
          offices={offices}
          fixedRole="OFFICIAL"
          currentUserId={actor.id}
          locale={locale}
        />
      </Card>
    </div>
  );
}
