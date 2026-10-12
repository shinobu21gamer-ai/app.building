import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { VerifyRecordForm } from "@/components/treasury/verify-record-form";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";

export const metadata: Metadata = {
  title: "COA codes and fund sources",
};

export const dynamic = "force-dynamic";

const TONES: Record<string, "green" | "amber" | "gray"> = {
  VERIFIED: "green",
  UNVERIFIED: "amber",
  DEPRECATED: "gray",
};

/**
 * The verification desk. A code may only be spent against once someone has
 * recorded where it was checked — that provenance is the audit trail the
 * Commission on Audit asks for.
 */
export default async function TreasuryCodesPage() {
  await requirePermission("treasury.coa.verify");
  const locale = await getLocale();
  const t = copy[locale].revamp.treasuryDesk;

  const [accounts, fundSources] = await Promise.all([
    db.coaAccount.findMany({
      orderBy: { code: "asc" },
      include: { _count: { select: { allocations: true } } },
    }),
    db.fundSource.findMany({
      orderBy: { code: "asc" },
      include: { _count: { select: { allocations: true } } },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t.codesTitle}</h1>
        <p className="mt-1 text-sm text-slate-600">{t.codesLead}</p>
      </div>

      <Card title={t.coaAccount}>
        <ul className="divide-y divide-slate-100">
          {accounts.map((account) => (
            <li key={account.id} className="space-y-2 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-slate-600">
                  {account.code}
                </span>
                <Badge tone={TONES[account.verificationStatus] ?? "neutral"}>
                  {account.verificationStatus}
                </Badge>
                {account.isMooe && <Badge tone="sky">MOOE</Badge>}
                <span className="text-sm text-slate-800">{account.name}</span>
              </div>
              <p className="text-xs text-slate-500">
                {account.accountClass}
                {account.groupCode ? ` · ${t.groupCode} ${account.groupCode}` : ""}
                {account.subObjectCodes
                  ? ` · ${t.subObjectCodes}: ${account.subObjectCodes}`
                  : ""}
                {` · ${account._count.allocations} ${t.budgetsTitle.toLowerCase()}`}
              </p>
              {account.verificationStatus === "VERIFIED" &&
                account.verificationSource && (
                  <p className="text-xs text-slate-500">
                    {t.verificationSource}: {account.verificationSource}
                    {account.verifiedAt
                      ? ` · ${t.verifiedOn.replace(
                          "{date}",
                          account.verifiedAt.toISOString().slice(0, 10)
                        )}`
                      : ""}
                  </p>
                )}
              <VerifyRecordForm
                kind="COA"
                recordId={account.id}
                currentStatus={account.verificationStatus}
                locale={locale}
              />
            </li>
          ))}
        </ul>
      </Card>

      <Card title={t.fundSource}>
        <ul className="divide-y divide-slate-100">
          {fundSources.map((source) => (
            <li key={source.id} className="space-y-2 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-slate-600">
                  {source.code}
                </span>
                <Badge tone={TONES[source.verificationStatus] ?? "neutral"}>
                  {source.verificationStatus}
                </Badge>
                <span className="text-sm text-slate-800">{source.name}</span>
              </div>
              <p className="text-xs text-slate-500">
                {source.description ?? "—"} · {source._count.allocations}{" "}
                {t.budgetsTitle.toLowerCase()}
              </p>
              <VerifyRecordForm
                kind="FUND"
                recordId={source.id}
                currentStatus={source.verificationStatus}
                locale={locale}
              />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
