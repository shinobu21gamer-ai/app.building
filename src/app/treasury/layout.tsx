import { RoleShell } from "@/components/role-shell";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";

export default async function TreasuryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const t = copy[locale].revamp;

  return (
    <RoleShell
      roles={["TREASURER", "ADMIN"]}
      items={[
        { href: "/treasury", label: t.treasury.title },
        { href: "/treasury/fund", label: t.treasuryDesk.navFundCase },
        { href: "/treasury/budgets", label: t.treasuryDesk.navBudgets },
        { href: "/treasury/earmarks", label: t.treasuryDesk.earmarksTitle },
        {
          href: "/treasury/disbursements",
          label: t.treasuryDesk.navDisbursements,
        },
        { href: "/treasury/ledger", label: t.treasuryDesk.navLedger },
        { href: "/treasury/reports", label: t.reports.title },
        { href: "/treasury/codes", label: t.treasuryDesk.navCodes },
        { href: "/notifications", label: t.common.notifications },
      ]}
    >
      {children}
    </RoleShell>
  );
}
