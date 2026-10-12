import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import {
  DsrQueue,
  PiiRevealForm,
  VerificationGateToggle,
} from "@/components/admin/privacy-desk";
import { requirePermission } from "@/lib/auth/session";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";
import { dsrStatusLabel, dsrTypeLabel } from "@/lib/privacy/catalog";
import {
  dsrCounts,
  listDataSubjectRequests,
  recentPiiAccessLog,
} from "@/lib/privacy/service";
import { isIdentityGateEnabled } from "@/lib/identity/verification";
import { maskedPhoneDisplay } from "@/lib/privacy/phone-store";


export const metadata: Metadata = {
  title: "Privacy desk",
  description:
    "Data subject requests, the personal-data access log and the identity-verification requirement.",
};

export const dynamic = "force-dynamic";

export default async function AdminPrivacyPage() {
  await requirePermission("privacy.dsr.handle");
  const locale = await getLocale();
  const t = copy[locale].revamp.adminDesk;

  const [requests, counts, accessLog, gateEnabled] = await Promise.all([
    listDataSubjectRequests(),
    dsrCounts(),
    recentPiiAccessLog(50),
    isIdentityGateEnabled(),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          {t.privacyTitle}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
          {t.privacyLead}
        </p>
        <p className="mt-2 text-xs text-slate-500">
          {counts.received} received · {counts.inReview} in review ·{" "}
          {counts.completed} completed · {counts.rejected} rejected ·{" "}
          {counts.overdue} overdue
        </p>
      </header>

      <Card title={t.gateTitle}>
        <VerificationGateToggle enabled={gateEnabled} locale={locale} />
      </Card>

      <Card title={t.dsrQueue}>
        <DsrQueue
          requests={requests.map((request) => ({
            id: request.id,
            referenceCode: request.referenceCode,
            type: request.type,
            typeLabel: dsrTypeLabel(request.type),
            status: request.status,
            statusLabel: dsrStatusLabel(request.status),
            requestedAt: request.requestedAt.toISOString(),
            dueAt: request.dueAt?.toISOString() ?? null,
            resolvedAt: request.resolvedAt?.toISOString() ?? null,
            details: request.details,
            resolutionNotes: request.resolutionNotes,
            denialReason: request.denialReason,
            overdue:
              request.dueAt !== null &&
              request.resolvedAt === null &&
              request.dueAt.getTime() < Date.now(),
            resident: {
              id: request.user.id,
              name: `${request.user.firstName} ${request.user.lastName}`.trim(),
              email: request.user.email,
              phoneMasked: maskedPhoneDisplay(request.user),
            },
          }))}
          locale={locale}
        />
      </Card>

      <Card title={t.reveal} description={t.revealHelp}>
        <PiiRevealForm locale={locale} />
      </Card>

      <Card title={t.accessLog} description={t.accessLogLead}>
        {accessLog.length === 0 ? (
          <p className="text-sm text-slate-500">{t.accessNone}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-2 py-2">{copy[locale].revamp.common.date}</th>
                  <th className="px-2 py-2">Actor</th>
                  <th className="px-2 py-2">Subject</th>
                  <th className="px-2 py-2">Field</th>
                  <th className="px-2 py-2">{copy[locale].revamp.common.reason}</th>
                </tr>
              </thead>
              <tbody>
                {accessLog.map((entry) => (
                  <tr key={entry.id} className="border-b border-slate-100">
                    <td className="px-2 py-2 text-xs text-slate-600">
                      {entry.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                    </td>
                    <td className="px-2 py-2 text-xs text-slate-700">
                      {entry.actor
                        ? `${entry.actor.firstName} ${entry.actor.lastName}`.trim()
                        : "system"}
                    </td>
                    <td className="px-2 py-2 text-xs text-slate-700">
                      {entry.subjectUser
                        ? `${entry.subjectUser.firstName} ${entry.subjectUser.lastName}`.trim()
                        : `#${entry.subjectUserId}`}
                    </td>
                    <td className="px-2 py-2 font-mono text-xs text-slate-600">
                      {entry.field}
                    </td>
                    <td className="px-2 py-2 text-xs text-slate-600">
                      {entry.purpose}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
