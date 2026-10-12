import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, FileText } from "lucide-react";

import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { StatCard } from "@/components/dashboard/stat-card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { listPublicCases, PUBLIC_PAGE_SIZE } from "@/lib/cases/public-query";
import { formatDate } from "@/lib/format";
import { copy, statusLabelFor } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = copy[locale].revamp.transparency;
  return {
    title: t.title,
    description: t.lead,
  };
}

type SearchParams = Promise<{
  type?: string;
  status?: string;
  area?: string;
  page?: string;
}>;

/**
 * The public transparency page: what the barangay did, with who it did it for
 * removed. It reads only the `PublicCaseRecord` projection (see
 * `src/lib/cases/public-query.ts`), which is populated on status changes and
 * only for residents who consented to publication.
 */
export default async function TransparencyPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const locale = await getLocale();
  const t = copy[locale].revamp.transparency;

  const requestedPage = Number(params.page);
  const data = await listPublicCases({
    typeKey: params.type,
    status: params.status,
    area: params.area,
    page: Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1,
  });

  const filters = {
    type: params.type,
    status: params.status,
    area: params.area,
  };

  const hrefFor = (
    overrides: Partial<{ type?: string; status?: string; area?: string; page?: number }>
  ) => {
    const query = new URLSearchParams();
    const merged = { ...filters, ...overrides } as Record<string, string | number | undefined>;
    for (const [key, value] of Object.entries(merged)) {
      if (value !== undefined && value !== "" && value !== null) {
        query.set(key, String(value));
      }
    }
    const search = query.toString();
    return search ? `/transparency?${search}` : "/transparency";
  };

  const chipClass = (active: boolean) =>
    cn(
      "tap-target inline-flex items-center rounded-full border px-3.5 text-sm font-medium transition-colors",
      active
        ? "border-brand-600 bg-brand-50 text-brand-800"
        : "border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink"
    );

  return (
    <Container className="py-8">
      <PageHeader
        title={t.title}
        description={t.lead}
        actions={
          <Button href="/track" variant="outline">
            {t.openCase}
            <ArrowRight size={16} aria-hidden="true" />
          </Button>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <StatCard label={t.statsPublished} value={data.stats.published} tone="brand" />
        <StatCard
          label={t.statsResolved}
          value={data.stats.resolved}
          hint={`${Math.round(data.stats.resolvedShare * 100)}%`}
        />
        <StatCard
          label={t.statsAvg}
          value={
            data.stats.averageResponseHours === null
              ? "—"
              : t.statsAvgValue.replace("{hours}", String(data.stats.averageResponseHours))
          }
          hint={data.stats.averageResponseHours === null ? t.statsAvgNone : undefined}
        />
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <p className="text-caption font-semibold uppercase tracking-wide text-ink-subtle">
            {t.filterType}
          </p>
          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
            <Link href={hrefFor({ type: undefined, page: undefined })} className={chipClass(!filters.type)}>
              {t.filterAll}
            </Link>
            {data.facets.types.map((type) => (
              <Link
                key={type.key}
                href={hrefFor({ type: type.key, page: undefined })}
                className={chipClass(filters.type === type.key)}
              >
                {type.label}
                <span className="ml-1.5 text-caption text-ink-subtle tabular-nums">
                  {type.count}
                </span>
              </Link>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-caption font-semibold uppercase tracking-wide text-ink-subtle">
            {t.filterStatus}
          </p>
          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
            <Link
              href={hrefFor({ status: undefined, page: undefined })}
              className={chipClass(!filters.status)}
            >
              {t.filterAll}
            </Link>
            {(
              [
                "IN_PROGRESS",
                "AWAITING_BUDGET",
                "UNDER_ASSESSMENT",
                "ASSIGNED",
                "SUBMITTED",
                "RESOLVED",
                "CLOSED",
              ] as const
            ).map((status) => (
              <Link
                key={status}
                href={hrefFor({ status, page: undefined })}
                className={chipClass(filters.status === status)}
              >
                {statusLabelFor(locale, status)}
              </Link>
            ))}
          </div>
        </div>

        {data.facets.areas.length > 0 ? (
          <div className="space-y-2">
            <p className="text-caption font-semibold uppercase tracking-wide text-ink-subtle">
              {t.filterArea}
            </p>
            <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
              <Link
                href={hrefFor({ area: undefined, page: undefined })}
                className={chipClass(!filters.area)}
              >
                {t.filterAll}
              </Link>
              {data.facets.areas.map((area) => (
                <Link
                  key={area}
                  href={hrefFor({ area, page: undefined })}
                  className={chipClass(filters.area === area)}
                >
                  {area}
                </Link>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <Card
        className="mt-6"
        flush
        title={data.total === 1 ? t.resultOne : t.resultMany.replace("{count}", String(data.total))}
      >
        {data.rows.length === 0 ? (
          <div className="px-4 py-4 sm:px-5">
            <EmptyState title={t.emptyTitle} description={t.emptyBody} />
          </div>
        ) : (
          <>
            <Table minWidthClass="min-w-[32rem]">
              <THead>
                <TR className="border-t-0 hover:bg-transparent">
                  <TH>{t.colRef}</TH>
                  <TH>{t.colType}</TH>
                  <TH>{t.colArea}</TH>
                  <TH>{t.colStatus}</TH>
                  <TH>{t.colSubmitted}</TH>
                  <TH>{t.colResolved}</TH>
                </TR>
              </THead>
              <TBody>
                {data.rows.map((row) => (
                  <TR key={row.publicRef}>
                    <TD>
                      <Link
                        href={`/transparency/${row.publicRef}`}
                        className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-brand-700 hover:underline"
                      >
                        <FileText size={14} aria-hidden="true" />
                        {row.publicRef}
                      </Link>
                    </TD>
                    <TD>{row.categoryName ?? row.typeKey ?? "—"}</TD>
                    <TD>{row.areaLabel ?? "—"}</TD>
                    <TD>
                      <StatusBadge
                        status={row.status}
                        label={statusLabelFor(locale, row.status)}
                      />
                    </TD>
                    <TD>{formatDate(row.submittedAt)}</TD>
                    <TD>{row.resolvedAt ? formatDate(row.resolvedAt) : "—"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>

            <div className="px-4 pb-4 sm:px-5">
              <Pagination
                page={data.page}
                pageCount={data.pageCount}
                total={data.total}
                pageSize={PUBLIC_PAGE_SIZE}
                showingLabel={t.pagerShown}
                previousLabel={t.pagerPrevious}
                nextLabel={t.pagerNext}
                hrefFor={(page) => hrefFor({ page })}
              />
            </div>
          </>
        )}
      </Card>

      <Card className="mt-6" title={t.privacyTitle}>
        <p className="text-sm leading-relaxed text-ink-subtle">{t.privacyBody}</p>
      </Card>
    </Container>
  );
}
