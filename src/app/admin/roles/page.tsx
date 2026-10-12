import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { PermissionMatrix } from "@/components/admin/permission-matrix";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/lib/auth/session";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";

export const metadata: Metadata = {
  title: "Roles and access",
  description: "Role matrix, permission catalogue and live overrides.",
};

export const dynamic = "force-dynamic";

export default async function AdminRolesPage() {
  await requirePermission("admin.rbac.manage");
  const locale = await getLocale();
  const t = copy[locale].revamp.adminDesk;

  return (
    <div className="space-y-6">
      <PageHeader title={t.rolesTitle} description={t.rolesLead} />

      <Card>
        <PermissionMatrix locale={locale} />
      </Card>
    </div>
  );
}
