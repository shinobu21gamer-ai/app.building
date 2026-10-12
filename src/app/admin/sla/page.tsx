import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EscalationTable } from "@/components/sla/escalation-table";
import { PolicyActions } from "@/components/sla/policy-actions";
import { PolicyForm } from "@/components/sla/policy-form";
import { RunScanButton } from "@/components/sla/run-scan-button";
import { PageHeader } from "@/components/ui/page-header";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";
import { listEscalationQueue, listSlaPolicies, slaOverview } from "@/lib/sla/escalation";
import { SLA_DEFAULT_HOURS } from "@/lib/sla/policy";

export const metadata: Metadata = {
  title: "SLA desk",
  description:
    "Where cases run late: the 48-hour windows, the escalation queue and the policy that decides who is told.",
};

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ status?: string }>;
};

/**
 * The administrator's SLA desk: the queue, the policies that decide windows and
 * recipients, and the record of every escalation run (so "did the job run?" is
 * answered from the database, not from logs).
 */
export default async function AdminSlaPage({ searchParams }: PageProps) {
  await requirePermission("sla.escalation.view");
  const locale = await getLocale();
  const t = copy[locale].revamp.slaDesk;
  const params = await searchParams;
  const status = ["OPEN", "ACKNOWLEDGED", "RESOLVED", "ALL"].includes(params.status ?? "")
    ? (params.status as "OPEN" | "ACKNOWLEDGED" | "RESOLVED" | "ALL")
    : "OPEN";

  const [overview, queue, policies, types] = await Promise.all([
    slaOverview(),
    listEscalationQueue({ status, limit: 25 }),
    listSlaPolicies(),
    db.concernType.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const filters: Array<{ value: string; label: string }> = [
    { value: "OPEN", label: t.statusOpen },
    { value: "ACKNOWLEDGED", label: t.statusAcknowledged },
    { value: "RESOLVED", label: t.resolved },
    { value: "ALL", label: t.all },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t.title} description={t.lead} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <p className="text-xs uppercase tracking-wide text-ink-subtle">{t.statOpen}</p>
          <p className="mt-1 text-2xl font-bold text-ink">{overview.counts.open}</p>
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-wide text-ink-subtle">
            {t.statAcknowledged}
          </p>
          <p className="mt-1 text-2xl font-bold text-ink">
            {overview.counts.acknowledged}
          </p>
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-wide text-ink-subtle">{t.statBreaching}</p>
          <p className="mt-1 text-2xl font-bold text-ink">
            {overview.breachingCases}
          </p>
          <p className="mt-1 text-xs text-ink-subtle">
            {t.statOpenCases.replace("{count}", String(overview.openCases))}
          </p>
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-wide text-ink-subtle">{t.statWindow}</p>
          <p className="mt-1 text-2xl font-bold text-ink">
            {overview.activePolicies > 0
              ? t.statPolicies.replace("{count}", String(overview.activePolicies))
              : `${SLA_DEFAULT_HOURS}h`}
          </p>
          <p className="mt-1 text-xs text-ink-subtle">
            {t.statPoliciesTotal.replace("{count}", String(overview.policies))}
          </p>
        </Card>
      </div>

      <Card title={t.queueTitle} description={t.queueLead}>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {filters.map((filter) => (
              <a
                key={filter.value}
                href={`/admin/sla?status=${filter.value}`}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${
                  status === filter.value
                    ? "border-brand-700 bg-brand-50 text-brand-800"
                    : "border-line text-ink-muted hover:border-line-strong"
                }`}
              >
                {filter.label}
              </a>
            ))}
            <span className="ml-auto text-xs text-ink-subtle">
              {t.showing.replace("{count}", String(queue.rows.length)).replace(
                "{total}",
                String(queue.total)
              )}
            </span>
          </div>
          <RunScanButton locale={locale} />
          <EscalationTable rows={queue.rows} locale={locale} showCaseLink />
        </div>
      </Card>

      <Card title={t.policiesTitle} description={t.policiesLead}>
        <div className="space-y-5">
          {policies.length === 0 ? (
            <p className="rounded-control border border-dashed border-line px-4 py-6 text-center text-sm text-ink-subtle">
              {t.policiesEmpty.replace("{hours}", String(SLA_DEFAULT_HOURS))}
            </p>
          ) : (
            <div className="space-y-3">
              {policies.map((policy) => (
                <div
                  key={policy.id}
                  className="rounded-card border border-line bg-surface p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-ink">{policy.name}</span>
                        <Badge tone={policy.isActive ? "green" : "gray"}>
                          {policy.isActive ? t.active : t.inactive}
                        </Badge>
                        <Badge tone="neutral">{policy.stage.replaceAll("_", " ")}</Badge>
                        <Badge tone="sky">
                          {policy.hours}h{" "}
                          {policy.hours === SLA_DEFAULT_HOURS ? t.defaultWindow : ""}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-ink-subtle">
                        {t.scope}: {policy.typeName ?? t.allTypes} ·{" "}
                        {policy.priorityLevel ?? t.allPriorities} · {t.escalateTo}{" "}
                        {policy.escalateToRole}
                        {policy.notifyRoles ? ` (+${policy.notifyRoles})` : ""} ·{" "}
                        {t.openCount.replace("{count}", String(policy.openEscalations))}
                      </p>
                      <p className="mt-0.5 font-mono text-[11px] text-ink-faint">
                        {policy.key} · {t.updated} {formatDateTime(policy.updatedAt)}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3">
                    <PolicyActions
                      locale={locale}
                      types={types}
                      policy={{
                        id: policy.id,
                        key: policy.key,
                        name: policy.name,
                        stage: policy.stage,
                        typeId: policy.typeId === null ? "" : String(policy.typeId),
                        priorityLevel: policy.priorityLevel ?? "",
                        hours: String(policy.hours),
                        escalateToRole: policy.escalateToRole,
                        notifyRoles: policy.notifyRoles ?? "",
                        isActive: policy.isActive,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="rounded-card border border-line bg-surface-muted p-4">
            <h3 className="text-sm font-semibold text-ink">{t.createPolicyTitle}</h3>
            <p className="mt-1 text-xs text-ink-subtle">{t.createPolicyLead}</p>
            <div className="mt-4">
              <PolicyForm locale={locale} types={types} />
            </div>
          </div>
        </div>
      </Card>

      <Card title={t.runsTitle} description={t.runsLead}>
        {overview.lastRuns.length === 0 ? (
          <p className="rounded-control border border-dashed border-line px-4 py-6 text-center text-sm text-ink-subtle">
            {t.runsEmpty}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table data-stack className="w-full min-w-[36rem] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-ink-subtle">
                <tr className="border-b border-line">
                  <th className="px-2 py-2">{t.colWhen}</th>
                  <th className="px-2 py-2">{t.colTrigger}</th>
                  <th className="px-2 py-2">{t.colStatus}</th>
                  <th className="px-2 py-2">{t.colEscalated}</th>
                </tr>
              </thead>
              <tbody>
                {overview.lastRuns.map((run) => (
                  <tr key={run.id} className="border-b border-line">
                    <td data-label={t.colWhen} className="px-2 py-2 whitespace-nowrap text-xs text-ink-subtle">
                      {formatDateTime(run.startedAt)}
                    </td>
                    <td data-label={t.colTrigger} className="px-2 py-2 text-xs text-ink-muted">{run.triggerSource}</td>
                    <td data-label={t.colStatus} className="px-2 py-2">
                      <Badge
                        tone={
                          run.status === "SUCCESS"
                            ? "green"
                            : run.status === "RUNNING"
                              ? "sky"
                              : "red"
                        }
                      >
                        {run.status}
                      </Badge>
                    </td>
                    <td data-label={t.colEscalated} className="px-2 py-2 text-xs text-ink-muted">
                      {run.processed}
                      {run.error ? (
                        <span className="ml-1 text-red-600">{run.error}</span>
                      ) : null}
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
