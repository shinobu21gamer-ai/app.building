/**
 * Where a notification should open when the person taps the row.
 *
 * Inboxes used to only link the case number (and only when a case existed),
 * so SLA, identity, earmark, and crew-check notes looked dead. This helper
 * is the single map from type + role → URL.
 */

export type NotificationHrefInput = {
  type: string;
  role: string;
  concernId: number | null;
  loginSecurityReportId?: number | null;
};

/** Desk sheet for a numbered case, or the crew board when they have no sheet. */
function caseHref(role: string, concernId: number): string {
  if (role === "RESIDENT") return `/resident/concerns/${concernId}`;
  if (role === "CREW") return "/crew";
  return `/official/concerns/${concernId}`;
}

/**
 * Returns the page this note should open, or null when there is nowhere to go
 * (for example a system ping with no case attached).
 */
export function notificationHref(input: NotificationHrefInput): string | null {
  const { type, role, concernId, loginSecurityReportId } = input;

  if (type === "CONSENT_REQUIRED") return "/privacy/requests";

  if (
    (type === "LOGIN_SECURITY_REPORT" || type === "LOGIN_SECURITY_REPORT_REMINDER") &&
    role === "ADMIN"
  ) {
    return loginSecurityReportId
      ? `/admin/security-reports#report-${loginSecurityReportId}`
      : "/admin/security-reports";
  }

  if (type === "CREW_PAYMENT_READY" && role === "TREASURER") {
    return concernId
      ? `/treasury/disbursements#crew-request-case-${concernId}`
      : "/treasury/disbursements#crew-payment-requests";
  }

  if (type === "FIELD_CHECK_ASSIGNED" && role === "CREW") return "/crew";

  if (type === "CONCERN_SUBMITTED" && role === "ADMIN") {
    return concernId ? `/official/concerns/${concernId}` : "/admin/validation";
  }

  if (type === "EARMARK_PROPOSED") {
    if (role === "CAPTAIN") {
      return concernId ? `/official/concerns/${concernId}` : "/captain/approvals";
    }
    if (role === "TREASURER") {
      return concernId ? `/treasury/fund?concernId=${concernId}` : "/treasury/earmarks";
    }
    return concernId ? caseHref(role, concernId) : "/captain/approvals";
  }

  if (type === "EARMARK_APPROVED" || type === "EARMARK_CANCELLED") {
    if (role === "TREASURER") {
      return concernId ? `/treasury/fund?concernId=${concernId}` : "/treasury/earmarks";
    }
    if (role === "OFFICIAL") {
      return concernId ? `/official/concerns/${concernId}` : "/official";
    }
    return concernId ? caseHref(role, concernId) : "/treasury";
  }

  if (type === "SLA_BREACHED") {
    return concernId ? caseHref(role, concernId) : "/captain";
  }

  if (concernId) return caseHref(role, concernId);
  return null;
}
