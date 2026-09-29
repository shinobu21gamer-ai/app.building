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
        <h1 className="text-2xl font-bold text-slate-900">Officials</h1>
        <p className="mt-1 text-sm text-slate-600">
          Manage the officials who handle concerns for each office. Disabling an
          official revokes sign-in access without deleting their case history.
        </p>
      </div>

      <AdminFilterBar
        initialQ={firstParam(params, "q")}
        qPlaceholder="Search officials by name or email"
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
        <UserManager
          users={officials.map(adminUserView)}
          roles={[{ id: 0, key: "OFFICIAL", name: "Official" }]}
          offices={offices}
          fixedRole="OFFICIAL"
          currentUserId={actor.id}
        />
      </Card>
    </div>
  );
}
