// The destinations each staff portal lists, in the order its roles work them.
//
// They live here rather than inside their layouts because one shell renders two
// roles' menus: the Captain opens the shared case sheet under `/official`
// (`SHARED_PORTAL_ROUTES` in `@/lib/auth/roles`), and while they sit on it the
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

/**
 * `/admin` — hall configuration. Daily case work is listed first so the phone
 * tabs are Dashboard, Validation, Field checks and ID verification — not
 * Reports / Users / Crew, which buried the desks admin actually uses on a
 * case. Reused on the shared case sheet so an administrator is not handed
 * the office queue while they review a case.
 */
export function adminNavItems(t: PortalCopy): NavItem[] {
  const admin = t.admin;
  const revamp = t.revamp.adminDesk;
  const work = admin.navSectionWork;
  const people = admin.navSectionPeople;
  const hall = admin.navSectionHall;
  const records = admin.navSectionRecords;
  return [
    { href: "/admin", label: admin.navDashboard, section: work },
    { href: "/admin/validation", label: revamp.validationNav, section: work },
    { href: "/admin/field-checks", label: admin.fieldCheck.navFieldCheck, section: work },
    { href: "/admin/verification", label: revamp.verificationNav, section: work },
    { href: "/admin/users", label: admin.navUsers, section: people },
    { href: "/admin/crew", label: admin.crew.navCrew, section: people },
    { href: "/admin/officials", label: admin.navOfficials, section: people },
    { href: "/admin/roles", label: revamp.rolesNav, section: people },
    { href: "/admin/offices", label: admin.navOffices, section: hall },
    { href: "/admin/categories", label: admin.navCategories, section: hall },
    { href: "/admin/routing", label: admin.navRouting, section: hall },
    { href: "/admin/priority", label: admin.navPriority, section: hall },
    { href: "/admin/treasury", label: revamp.treasuryNav, section: hall },
    { href: "/admin/sla", label: revamp.slaNav, section: hall },
    { href: "/admin/settings", label: admin.navSettings, section: hall },
    { href: "/admin/reports", label: admin.navReports, section: records },
    { href: "/admin/privacy", label: revamp.privacyNav, section: records },
    { href: "/admin/security-reports", label: admin.securityReportsNav, section: records },
    { href: "/admin/audit", label: revamp.auditNav, section: records },
    { href: "/admin/deleted", label: revamp.deletedNav, section: records },
    { href: "/notifications", label: admin.navNotifications, section: records },
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
