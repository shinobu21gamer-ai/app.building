import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";
import { listDeletionEntries } from "@/lib/audit/store";

export const metadata: Metadata = {
  title: "Deleted records",
  description:
    "A register of everything removed from the database, read back from the audit chain.",
};

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

type PageProps = {
  searchParams: Promise<{ q?: string; offset?: string }>;
};

/** A friendly name for the thing that was removed. */
const RESOURCE_LABEL: Record<string, string> = {
  office: "Office",
  concern_category: "Category",
  routing_rule: "Routing rule",
  setting: "Setting",
  user: "Account",
};

function resourceLabel(resourceType: string): string {
  return RESOURCE_LABEL[resourceType] ?? resourceType;
}

/**
 * The deleted-records register.
 *
 * "Where does deleted data go?" has a two-part answer, and this page is both
 * parts: the app refuses to delete anything with linked history (so case
 * history is never destroyed), and every deletion that *is* allowed leaves a
 * chained audit row — which is what this desk lists, newest first.
 */
export default async function AdminDeletedPage({ searchParams }: PageProps) {
  await requirePermission("admin.audit.view");
  const locale = await getLocale();
  const t = copy[locale].revamp.deletedDesk;
  const params = await searchParams;
  const offset = Math.max(Number(params.offset ?? 0) || 0, 0);

  const { rows, total } = await listDeletionEntries({
    q: params.q ?? null,
    limit: PAGE_SIZE,
    offset,
  });

  const prevOffset = Math.max(offset - PAGE_SIZE, 0);
  const nextOffset = offset + PAGE_SIZE;
  const withParam = (patch: Record<string, string | number>) => {
    const search = new URLSearchParams();
    if (params.q) search.set("q", params.q);
    for (const [key, value] of Object.entries(patch)) search.set(key, String(value));
    return `/admin/deleted?${search.toString()}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t.title} description={t.lead} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={t.policyTitle}>
          <p className="text-sm leading-relaxed text-ink-muted">{t.policyBody}</p>
        </Card>
        <Card title={t.recordedTitle}>
          <p className="text-sm leading-relaxed text-ink-muted">{t.recordedBody}</p>
          <Link
            href="/admin/audit"
            className="mt-3 inline-flex text-sm font-semibold text-brand-700 underline decoration-brand-300 underline-offset-2 hover:text-brand-900"
          >
            {t.viewAudit}
          </Link>
        </Card>
        <Card title={t.restoreTitle}>
          <p className="text-sm leading-relaxed text-ink-muted">{t.restoreBody}</p>
          <Link
            href="/admin/privacy"
            className="mt-3 inline-flex text-sm font-semibold text-brand-700 underline decoration-brand-300 underline-offset-2 hover:text-brand-900"
          >
            {t.viewRetention}
          </Link>
        </Card>
      </div>

      <Card
        title={t.title}
        description={t.resultCount.replace("{count}", String(total))}
      >
        <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
          <div className="min-w-[240px] flex-1">
            <label
              htmlFor="deleted-q"
              className="mb-1 block text-xs font-medium text-ink-muted"
            >
              {t.search}
            </label>
            <input
              id="deleted-q"
              name="q"
              type="search"
              defaultValue={params.q ?? ""}
              placeholder={t.searchPlaceholder}
              className="h-10 w-full rounded-control border border-line-strong bg-surface px-3 text-sm text-ink focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30"
            />
          </div>
          <button
            type="submit"
            className="h-10 rounded-control bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-800"
          >
            {t.search}
          </button>
        </form>

        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-muted">{t.empty}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-subtle">
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    {t.colWhen}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    {t.colAction}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    {t.colRecord}
                  </th>
                  <th scope="col" className="py-2 font-semibold">
                    {t.colWho}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-surface-muted">
                    <td className="py-3 pr-4 align-top text-ink-muted">
                      {formatDateTime(row.createdAt)}
                      {row.seq !== null && (
                        <span className="block text-xs text-ink-subtle">
                          seq {row.seq.toString()}
                        </span>
                      )}
                    </td>
                    <td className="py-3 pr-4 align-top">
                      <Badge tone="red">{row.action.replace(/_/g, " ")}</Badge>
                    </td>
                    <td className="py-3 pr-4 align-top">
                      <span className="font-medium text-ink">
                        {resourceLabel(row.resourceType)}
                        {row.resourceId ? ` #${row.resourceId}` : ""}
                      </span>
                      {row.description && (
                        <span className="mt-0.5 block text-xs text-ink-muted">
                          {row.description}
                        </span>
                      )}
                    </td>
                    <td className="py-3 align-top text-ink-muted">
                      {row.user
                        ? `${row.user.firstName} ${row.user.lastName}`
                        : t.unknownActor}
                      {row.actorRole && (
                        <span className="block text-xs text-ink-subtle">
                          {row.actorRole}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {total > PAGE_SIZE && (
          <div className="mt-4 flex items-center justify-between gap-3 text-sm">
            {offset > 0 ? (
              <Link
                href={withParam({ offset: prevOffset })}
                className="font-semibold text-brand-700 hover:text-brand-900"
              >
                ← Newer
              </Link>
            ) : (
              <span />
            )}
            <span className="text-xs text-ink-subtle">
              {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} / {total}
            </span>
            {offset + PAGE_SIZE < total ? (
              <Link
                href={withParam({ offset: nextOffset })}
                className="font-semibold text-brand-700 hover:text-brand-900"
              >
                Older →
              </Link>
            ) : (
              <span />
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
