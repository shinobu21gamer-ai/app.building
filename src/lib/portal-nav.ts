// The destinations each staff portal lists, in the order its roles work them.
//
// They live here rather than inside their layouts because one shell renders two
// roles' menus: the Captain opens the shared case sheet under `/official`
// (`SHARED_PORTAL_ROUTES` in `@/lib/auth/roles`), and while they are on it the
// official shell must offer the Captain's own desks. Handing a Captain the
// office's menu would be a wall of doors that turn them away — the queue, the
// dashboard and the reports are all scoped to one office.
//
// Order decides the phone tabs (`partitionNav`), so the most-used destination
// stays first. The labels come from the locale copy passed in, so a portal adds
// a desk the same way it always did: one entry here and a page to land on.

import type { Locale } from "@/lib/i18n";
import { copy } from "@/lib/i18n";
import type { NavItem } from "@/lib/nav";

/** One locale's copy, as every layout reads it. */
export type PortalCopy = (typeof copy)[Locale];

/** `/official` — the office's desk: its queue, its dashboard, its reports. */
export function officialNavItems(t: PortalCopy): NavItem[] {
  return [
    { href: "/official", label: t.official.navDashboard },
    { href: "/official/concerns", label: t.official.navConcerns },
    { href: "/official/reports", label: t.revamp.reports.title },
    { href: "/notifications", label: t.official.navNotifications },
  ];
}

/** `/treasury` — funding, budgets, earmarks, vouchers, ledger. */
export function treasuryNavItems(t: PortalCopy): NavItem[] {
  const desk = t.revamp.treasuryDesk;
  return [
    { href: "/treasury", label: t.revamp.treasury.title },
    { href: "/treasury/fund", label: desk.navFundCase },
    { href: "/treasury/budgets", label: desk.navBudgets },
    { href: "/treasury/earmarks", label: desk.earmarksTitle },
    { href: "/treasury/disbursements", label: desk.navDisbursements },
    { href: "/treasury/ledger", label: desk.navLedger },
    { href: "/treasury/reports", label: t.revamp.reports.title },
    { href: "/treasury/codes", label: desk.navCodes },
    { href: "/notifications", label: t.revamp.common.notifications },
  ];
}

/** `/admin` — hall configuration. Reused on the shared case sheet so an
 *  administrator is not handed the office queue while they review a case. */
export function adminNavItems(t: PortalCopy): NavItem[] {
  const admin = t.admin;
  const revamp = t.revamp.adminDesk;
  return [
    { href: "/admin", label: admin.navDashboard },
    { href: "/admin/reports", label: admin.navReports },
    { href: "/admin/users", label: admin.navUsers },
    { href: "/admin/crew", label: admin.crew.navCrew },
    { href: "/admin/officials", label: admin.navOfficials },
    { href: "/admin/offices", label: admin.navOffices },
    { href: "/admin/categories", label: admin.navCategories },
    { href: "/admin/routing", label: admin.navRouting },
    { href: "/admin/priority", label: admin.navPriority },
    { href: "/admin/validation", label: revamp.validationNav },
    { href: "/admin/field-checks", label: admin.fieldCheck.navFieldCheck },
    { href: "/admin/verification", label: revamp.verificationNav },
    { href: "/admin/privacy", label: revamp.privacyNav },
    { href: "/admin/roles", label: revamp.rolesNav },
    { href: "/admin/treasury", label: revamp.treasuryNav },
    { href: "/admin/sla", label: revamp.slaNav },
    { href: "/admin/audit", label: revamp.auditNav },
    { href: "/admin/deleted", label: revamp.deletedNav },
    { href: "/admin/settings", label: admin.navSettings },
    { href: "/notifications", label: admin.navNotifications },
  ];
}

/** `/captain` — approvals, escalations, the closure queue and the reports. */
export function captainNavItems(t: PortalCopy): NavItem[] {
  return [
    { href: "/captain", label: t.revamp.captain.title },
    { href: "/captain/closure", label: t.revamp.captain.closeQueueTitle },
    { href: "/captain/escalations", label: t.revamp.slaDesk.navEscalations },
    { href: "/captain/approvals", label: t.revamp.treasuryDesk.navApprovals },
    { href: "/captain/reports", label: t.revamp.reports.title },
    { href: "/notifications", label: t.revamp.common.notifications },
  ];
}
