import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { RoleShell } from "@/components/role-shell";
import { ConsentPanel } from "@/components/privacy/consent-panel";
import { DsrRequestForm } from "@/components/privacy/dsr-form";
import { requireUser } from "@/lib/auth/session";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";
import {
  CONSENT_PURPOSES_DEFINITIONS,
  PRIVACY_POLICY_VERSION,
} from "@/lib/privacy/catalog";
import { currentConsents } from "@/lib/privacy/consent";
import { listMyDataSubjectRequests } from "@/lib/privacy/service";

export const metadata: Metadata = {
  title: "Your data and your rights",
  description:
    "Consent history, data subject requests and the barangay's answers, under the Data Privacy Act of 2012.",
};

export const dynamic = "force-dynamic";

export default async function PrivacyRequestsPage() {
  const user = await requireUser();
  const locale = await getLocale();
  const t = copy[locale].revamp.privacyCenter;

  const [consents, requests] = await Promise.all([
    currentConsents(user.id),
    listMyDataSubjectRequests(user.id),
  ]);

  return (
    <RoleShell
      roles={["RESIDENT", "OFFICIAL", "CREW", "TREASURER", "CAPTAIN", "ADMIN"]}
      items={[
        { href: "/privacy/requests", label: t.title },
        { href: "/privacy", label: copy[locale].privacy.kicker },
      ]}
    >
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            {t.title}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
            {t.lead}
          </p>
          <p className="mt-2 text-xs text-slate-500">
            {copy[locale].privacy.title} · v{PRIVACY_POLICY_VERSION}
          </p>
        </header>

        <Card title={t.consentsTitle} description={t.consentsLead}>
          <ConsentPanel
            consents={consents.map((consent) => ({
              purpose: consent.purpose,
              status: consent.status,
              policyVersion: consent.policyVersion,
              grantedAt: consent.grantedAt.toISOString(),
              withdrawnAt: consent.withdrawnAt?.toISOString() ?? null,
            }))}
            catalog={CONSENT_PURPOSES_DEFINITIONS}
            policyVersion={PRIVACY_POLICY_VERSION}
            locale={locale}
          />
        </Card>

        <Card title={t.requestsTitle} description={t.requestsLead}>
          <DsrRequestForm locale={locale} />
        </Card>

        <Card title={t.myRequests}>
          {requests.length === 0 ? (
            <p className="text-sm text-slate-500">{t.none}</p>
          ) : (
            <ul className="space-y-3">
              {requests.map((request) => {
                const overdue =
                  request.dueAt !== null &&
                  request.resolvedAt === null &&
                  request.dueAt.getTime() < Date.now();
                return (
                  <li
                    key={request.id}
                    className="rounded-lg border border-slate-200 px-4 py-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-slate-900">
                        {request.referenceCode} ·{" "}
                        {t.requestTypes[
                          request.type as keyof typeof t.requestTypes
                        ] ?? request.type}
                      </p>
                      <div className="flex items-center gap-2">
                        {overdue && <Badge tone="red">{t.overdue}</Badge>}
                        <Badge
                          tone={
                            request.status === "COMPLETED"
                              ? "green"
                              : request.status === "REJECTED"
                                ? "gray"
                                : "amber"
                          }
                        >
                          {request.status}
                        </Badge>
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {t.requested}: {request.requestedAt.toISOString().slice(0, 10)}
                      {request.dueAt
                        ? ` · ${t.due}: ${request.dueAt.toISOString().slice(0, 10)}`
                        : ""}
                    </p>
                    {request.resolutionNotes && (
                      <p className="mt-1 text-xs text-slate-600">
                        {t.resolution}: {request.resolutionNotes}
                      </p>
                    )}
                    {request.denialReason && (
                      <p className="mt-1 text-xs text-slate-600">
                        {t.denial}: {request.denialReason}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <p className="text-sm">
          <Link className="text-brand-700 underline" href="/privacy">
            {copy[locale].privacy.title}
          </Link>
        </p>
      </div>
    </RoleShell>
  );
}

