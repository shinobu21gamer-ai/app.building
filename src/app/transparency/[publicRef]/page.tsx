import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { MapFrame } from "@/components/ui/map-frame";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/badge";
import { publicCaseDetail } from "@/lib/cases/public-query";
import { formatDate } from "@/lib/format";
import { copy, statusLabelFor } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";
import { OSM_ATTRIBUTION, OSM_COPYRIGHT_URL } from "@/lib/maps";

export const dynamic = "force-dynamic";

/** The public map is deliberately coarser than the case map. */
const PUBLIC_MAP_ZOOM = 14;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ publicRef: string }>;
}): Promise<Metadata> {
  const { publicRef } = await params;
  const locale = await getLocale();
  const t = copy[locale].revamp.transparency;
  return { title: t.detailTitle.replace("{ref}", publicRef) };
}

export default async function PublicCasePage({
  params,
}: {
  params: Promise<{ publicRef: string }>;
}) {
  const { publicRef } = await params;
  const locale = await getLocale();
  const t = copy[locale].revamp.transparency;

  const row = await publicCaseDetail(publicRef);
  if (!row) notFound();

  const rows: { label: string; value: React.ReactNode }[] = [
    { label: t.detailArea, value: row.areaLabel ?? "—" },
    { label: t.detailService, value: row.categoryName ?? row.typeKey ?? "—" },
    {
      label: t.detailStatus,
      value: (
        <StatusBadge status={row.status} label={statusLabelFor(locale, row.status)} />
      ),
    },
    { label: t.detailSubmitted, value: formatDate(row.submittedAt) },
    {
      label: t.detailResolved,
      value: row.resolvedAt ? formatDate(row.resolvedAt) : "—",
    },
    {
      label: t.detailClosed,
      value: row.closedAt ? formatDate(row.closedAt) : "—",
    },
    {
      label: t.detailHours,
      value:
        row.responseHours === null
          ? "—"
          : t.detailHoursValue.replace("{hours}", String(row.responseHours)),
    },
    { label: t.detailOutcome, value: row.resolutionType ?? "—" },
  ];

  return (
    <Container className="py-8">
      <Link
        href="/transparency"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline"
      >
        <ArrowLeft size={15} aria-hidden="true" />
        {t.detailBack}
      </Link>

      <PageHeader
        title={row.publicTitle ?? t.detailTitle.replace("{ref}", row.publicRef)}
        description={t.detailLead}
        actions={
          <Button href="/track" variant="outline">
            {t.openCase}
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t.detailMapTitle} description={t.detailMapNote}>
          <MapFrame
            lat={row.lat}
            lng={row.lng}
            zoom={PUBLIC_MAP_ZOOM}
            title={t.detailMapTitle}
            emptyLabel={t.detailMapNote}
            openLabel={t.detailBack}
            attribution={OSM_ATTRIBUTION}
            attributionUrl={OSM_COPYRIGHT_URL}
          />
        </Card>

        <Card>
          <dl className="divide-y divide-line">
            {rows.map((entry) => (
              <div
                key={entry.label}
                className="flex items-start justify-between gap-4 py-2.5 first:pt-0 last:pb-0"
              >
                <dt className="text-sm text-ink-subtle">{entry.label}</dt>
                <dd className="text-right text-sm font-medium text-ink">
                  {entry.value}
                </dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title={t.privacyTitle}>
          <p className="text-sm leading-relaxed text-ink-subtle">{t.privacyBody}</p>
        </Card>
        <Card title={t.openCase} description={t.openCaseLead}>
          <Button href="/track">{t.openCase}</Button>
        </Card>
      </div>
    </Container>
  );
}
