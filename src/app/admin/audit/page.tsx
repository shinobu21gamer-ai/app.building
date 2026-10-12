import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PrintButton } from "@/components/ui/print-button";
import { AuditTable } from "@/components/audit/audit-table";
import { VerifyButton } from "@/components/audit/verify-button";
import { requirePermission } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";
import {
  auditChainStatus,
  auditDigest,
  auditFacets,
  listAuditEntries,
} from "@/lib/audit/store";

export const metadata: Metadata = {
  title: "Audit trail",
  description:
    "The hash-chained audit log: what happened, in what order, and whether the chain still verifies.",
};

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    q?: string;
    action?: string;
    resourceType?: string;
    actorRole?: string;
    chained?: string;
    offset?: string;
  }>;
};

function shortHash(hash: string): string {
  return hash ? `${hash.slice(0, 16)}…` : "—";
}

/**
 * The audit desk. It shows the chain's own state first — because the value of an
 * audit log is not the rows, it is whether the rows still agree with each other.
 */
export default async function AdminAuditPage({ searchParams }: PageProps) {
  await requirePermission("admin.audit.view");
  const locale = await getLocale();
  const t = copy[locale].revamp.auditDesk;
  const params = await searchParams;
  const offset = Math.max(Number(params.offset ?? 0) || 0, 0);

  const [status, facets, listing, digest] = await Promise.all([
    auditChainStatus(),
    auditFacets(),
    listAuditEntries({
      q: params.q ?? null,
      action: params.action ?? null,
      resourceType: params.resourceType ?? null,
      actorRole: params.actorRole ?? null,
      chained: params.chained === null || params.chained === undefined
        ? null
        : params.chained !== "false",
      limit: 50,
      offset,
    }),
    auditDigest(),
  ]);

  const prevOffset = Math.max(offset - 50, 0);
  const nextOffset = offset + 50;
  const query = (patch: Record<string, string | number>) => {
    const search = new URLSearchParams();
    if (params.q) search.set("q", params.q);
    if (params.action) search.set("action", params.action);
    if (params.resourceType) search.set("resourceType", params.resourceType);
    if (params.actorRole) search.set("actorRole", params.actorRole);
    if (params.chained) search.set("chained", params.chained);
    for (const [key, value] of Object.entries(patch)) search.set(key, String(value));
    return `/admin/audit?${search.toString()}`;
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-title text-ink">{t.title}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-muted">{t.lead}</p>
        </div>
        <Badge tone={status.healthy ? "green" : status.lastRun ? "red" : "amber"}>
          {status.healthy
            ? t.chainHealthy
            : status.lastRun
              ? t.chainUnverified
              : t.chainNeverVerified}
        </Badge>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <p className="text-xs uppercase tracking-wide text-ink-subtle">{t.statTip}</p>
          <p className="mt-1 text-2xl font-bold text-ink">
            {status.state.lastSeq.toString()}
          </p>
          <p className="mt-1 font-mono text-[11px] text-slate-400">
            {shortHash(status.state.lastHash)}
          </p>
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-wide text-ink-subtle">{t.statVerified}</p>
          <p className="mt-1 text-2xl font-bold text-ink">
            {status.state.lastVerifiedSeq.toString()}
          </p>
          <p className="mt-1 text-xs text-ink-subtle">
            {t.statLag.replace("{count}", String(status.verifiedLag))}
          </p>
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-wide text-ink-subtle">{t.statRows}</p>
          <p className="mt-1 text-2xl font-bold text-ink">{status.totalCount}</p>
          <p className="mt-1 text-xs text-ink-subtle">
            {t.statChained.replace("{count}", String(status.chainedCount))}
          </p>
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-wide text-ink-subtle">{t.statUnchained}</p>
          <p className="mt-1 text-2xl font-bold text-ink">{status.unchainedCount}</p>
          <p className="mt-1 text-xs text-ink-subtle">
            {status.unchainedCount === 0 ? t.unchainedNone : t.unchainedHint}
          </p>
        </Card>
      </div>

      <Card title={t.verifyTitle} description={t.verifyLead}>
        <VerifyButton locale={locale} />
      </Card>

      <Card title={t.digestTitle} description={t.digestLead}>
        <div className="space-y-3">
          <pre className="overflow-x-auto rounded-control border border-line bg-surface-muted p-4 text-xs leading-relaxed text-ink-muted">
            {digest.lines.join("\n")}
          </pre>
          <div className="flex flex-wrap items-center gap-2">
            <PrintButton label={t.printDigest} />
            <span className="text-xs text-ink-subtle">{t.digestNote}</span>
          </div>
        </div>
      </Card>

      <Card title={t.runsTitle} description={t.runsLead}>
        {status.lastRun === null ? (
          <p className="rounded-control border border-dashed border-line px-4 py-6 text-center text-sm text-ink-subtle">
            {t.runsEmpty}
          </p>
        ) : (
          <div className="grid gap-2 text-sm text-ink-muted sm:grid-cols-2 lg:grid-cols-4">
            <p>
              <span className="text-xs uppercase tracking-wide text-ink-subtle">
                {t.colRunStatus}
              </span>
              <br />
              <Badge tone={status.lastRun.status === "OK" ? "green" : "red"}>
                {status.lastRun.status}
              </Badge>
            </p>
            <p>
              <span className="text-xs uppercase tracking-wide text-ink-subtle">
                {t.colChecked}
              </span>
              <br />
              {status.lastRun.checkedCount}
            </p>
            <p>
              <span className="text-xs uppercase tracking-wide text-ink-subtle">
                {t.colRange}
              </span>
              <br />
              {status.lastRun.fromSeq.toString()}–{status.lastRun.toSeq.toString()}
            </p>
            <p>
              <span className="text-xs uppercase tracking-wide text-ink-subtle">
                {t.colRunWhen}
              </span>
              <br />
              {formatDateTime(status.lastRun.startedAt)} · {status.lastRun.triggeredBy}
            </p>
          </div>
        )}
      </Card>

      <Card title={t.entriesTitle} description={t.entriesLead}>
        <form className="mb-4 flex flex-wrap items-end gap-2" method="get">
          <label className="text-xs text-ink-muted">
            {t.searchLabel}
            <input
              name="q"
              defaultValue={params.q ?? ""}
              className="mt-1 h-9 w-56 rounded-control border border-line-strong px-3 text-sm"
            />
          </label>
          <label className="text-xs text-ink-muted">
            {t.colAction}
            <select
              name="action"
              defaultValue={params.action ?? ""}
              className="mt-1 h-9 rounded-control border border-line-strong bg-surface px-3 text-sm"
            >
              <option value="">{t.any}</option>
              {facets.actions.map((action) => (
                <option key={action} value={action}>
                  {action}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-ink-muted">
            {t.colResource}
            <select
              name="resourceType"
              defaultValue={params.resourceType ?? ""}
              className="mt-1 h-9 rounded-control border border-line-strong bg-surface px-3 text-sm"
            >
              <option value="">{t.any}</option>
              {facets.resourceTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-ink-muted">
            {t.colActor}
            <select
              name="actorRole"
              defaultValue={params.actorRole ?? ""}
              className="mt-1 h-9 rounded-control border border-line-strong bg-surface px-3 text-sm"
            >
              <option value="">{t.any}</option>
              {facets.actorRoles.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="h-9 rounded-control bg-brand-700 px-4 text-sm font-semibold text-white"
          >
            {t.filter}
          </button>
        </form>

        <AuditTable rows={listing.rows} locale={locale} />

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-subtle">
          <span>
            {t.showing
              .replace("{count}", String(listing.rows.length))
              .replace("{total}", String(listing.total))}
          </span>
          <span className="flex gap-2">
            {offset > 0 ? (
              <a className="underline" href={query({ offset: prevOffset })}>
                {t.previous}
              </a>
            ) : null}
            {offset + 50 < listing.total ? (
              <a className="underline" href={query({ offset: nextOffset })}>
                {t.next}
              </a>
            ) : null}
          </span>
        </div>
      </Card>
    </div>
  );
}
