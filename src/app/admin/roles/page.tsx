import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { PermissionMatrix } from "@/components/admin/permission-matrix";
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
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          {t.rolesTitle}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
          {t.rolesLead}
        </p>
      </header>

      <Card>
        <PermissionMatrix locale={locale} />
      </Card>
    </div>
  );
}
