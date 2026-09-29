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
  title: "Users",
};

type SearchParams = Record<string, string | string[] | undefined>;

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const actor = await requireRole(["ADMIN"]);
  const params = await searchParams;
  const filters = parseUserFilters(params);

  const [users, roles, offices] = await Promise.all([
    listAdminUsers(filters),
    db.role.findMany({
      orderBy: { id: "asc" },
      select: { id: true, key: true, name: true },
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
        <h1 className="text-2xl font-bold text-slate-900">User accounts</h1>
        <p className="mt-1 text-sm text-slate-600">
          Create accounts, assign roles and offices, and enable or disable
          access. Disabling preserves historical records.
        </p>
      </div>

      <AdminFilterBar
        initialQ={firstParam(params, "q")}
        qPlaceholder="Search by name or email"
        fields={[
          {
            name: "role",
            label: "Role",
            options: [
              { value: "", label: "All roles" },
              ...roles.map((role) => ({ value: role.key, label: role.name })),
            ],
          },
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
        initialValues={{
          role: firstParam(params, "role"),
          status: firstParam(params, "status"),
        }}
      />

      <Card>
        <UserManager
          users={users.map(adminUserView)}
          roles={roles}
          offices={offices}
          currentUserId={actor.id}
        />
      </Card>
    </div>
  );
}
