import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { EscalationTable } from "@/components/sla/escalation-table";
import { requirePermission } from "@/lib/auth/session";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";
import { listEscalationQueue } from "@/lib/sla/escalation";

export const metadata: Metadata = {
  title: "Escalations",
  description:
    "Cases that ran past their 48-hour window, who was told, and what the Captain has acknowledged.",
};

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ status?: string }>;
};

/**
 * The Captain's escalation queue. It shows what is addressed to the Captain
 * role — the policies that escalate elsewhere are the administrator's to watch,
 * and they see them all on the SLA desk.
 */
export default async function CaptainEscalationsPage({ searchParams }: PageProps) {
  await requirePermission("sla.escalation.view");
  const locale = await getLocale();
  const t = copy[locale].revamp.slaDesk;
  const params = await searchParams;
  const status = ["OPEN", "ACKNOWLEDGED", "RESOLVED", "ALL"].includes(params.status ?? "")
    ? (params.status as "OPEN" | "ACKNOWLEDGED" | "RESOLVED" | "ALL")
    : "OPEN";

  const queue = await listEscalationQueue({ roleKeys: ["CAPTAIN"], status, limit: 50 });

  const filters: Array<{ value: string; label: string }> = [
    { value: "OPEN", label: t.statusOpen },
    { value: "ACKNOWLEDGED", label: t.statusAcknowledged },
    { value: "RESOLVED", label: t.resolved },
    { value: "ALL", label: t.all },
  ];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{t.captainTitle}</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">
          {t.captainLead}
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <p className="text-xs uppercase tracking-wide text-slate-500">{t.statOpen}</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{queue.counts.open}</p>
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-wide text-slate-500">
            {t.statAcknowledged}
          </p>
          <p className="mt-1 text-2xl font-bold text-slate-900">
            {queue.counts.acknowledged}
          </p>
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-wide text-slate-500">{t.resolved}</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{queue.counts.resolved}</p>
        </Card>
      </div>

      <Card title={t.queueTitle} description={t.captainQueueLead}>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {filters.map((filter) => (
              <a
                key={filter.value}
                href={`/captain/escalations?status=${filter.value}`}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${
                  status === filter.value
                    ? "border-brand-700 bg-brand-50 text-brand-800"
                    : "border-slate-200 text-slate-600 hover:border-slate-300"
                }`}
              >
                {filter.label}
              </a>
            ))}
          </div>
          <EscalationTable rows={queue.rows} locale={locale} />
        </div>
      </Card>
    </div>
  );
}
