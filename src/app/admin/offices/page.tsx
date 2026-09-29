import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/session";
import { Card } from "@/components/ui/card";
import { AdminFilterBar } from "@/components/admin/admin-filter-bar";
import { OfficeManager } from "@/components/admin/office-manager";
import {
  adminOfficeView,
  listAdminOffices,
  parseNameFilters,
} from "@/lib/admin/query";
import { firstParam } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Offices",
};

type SearchParams = Record<string, string | string[] | undefined>;

export default async function AdminOfficesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireRole(["ADMIN"]);
  const params = await searchParams;
  const filters = parseNameFilters(params);
  const offices = await listAdminOffices(filters);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Offices</h1>
        <p className="mt-1 text-sm text-slate-600">
          Offices receive routed concerns. An office that is referenced by any
          record can be disabled but not deleted, so historical routing stays
          intact.
        </p>
      </div>

      <AdminFilterBar
        initialQ={firstParam(params, "q")}
        qPlaceholder="Search by office name or code"
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
        <OfficeManager offices={offices.map(adminOfficeView)} />
      </Card>
    </div>
  );
}
