import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { PriorityBadge, StatusBadge } from "@/components/ui/badge";
import { StatCard } from "@/components/dashboard/stat-card";
import { ConcernFilters } from "@/components/cases/concern-filters";
import { FieldCheckSubmitForm } from "@/components/cases/field-check-panel";
import { parseConcernFilters } from "@/lib/cases/query";
import { concernProcessFlow, roleActsOnProcessStep } from "@/lib/cases/process-flow";
import { hasCoordinates, openStreetMapUrl } from "@/lib/maps";
import { getOfficialDashboard } from "@/lib/dashboards/official";
import { fundedAmountsByConcern } from "@/lib/treasury/query";
import { formatDate, formatDateTime } from "@/lib/format";
import { firstParam } from "@/lib/utils";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";
import { DeskGuide } from "@/components/portals/desk-guide";

export const metadata: Metadata = {
  title: "Official Dashboard",
};

type SearchParams = Record<string, string | string[] | undefined>;

export default async function OfficialPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireRole(["OFFICIAL", "ADMIN"]);
  const locale = await getLocale();
  const t = copy[locale].official;
  const params = await searchParams;
  const filters = parseConcernFilters(params);

  const isOfficial = user.role.key === "OFFICIAL";
  const showOfficeScope = !isOfficial;
  const officeId = isOfficial ? (user.officeId ?? -1) : null;

  const [categories, offices, dashboard] = await Promise.all([
    db.concernCategory.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    showOfficeScope
      ? db.office.findMany({
          where: { isActive: true },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : Promise.resolve([] as { id: number; name: string }[]),
    getOfficialDashboard(officeId, filters),
  ]);

  const { counts, recentlyResolved, cases } = dashboard;

  // Field checks handed to this user personally. The check belongs to the
  // person, not to the office: somebody from another office can be sent when
  // the case office has nobody free, and this card is where they pick the work
  // up — the case sheet itself stays scoped to the case office.
  const fieldChecks = await db.fieldCheck.findMany({
    where: { assigneeId: user.id, status: "PENDING" },
    orderBy: { createdAt: "desc" },
    include: {
      concern: {
        select: {
          caseNumber: true,
          title: true,
          locationAddress: true,
          locationPurok: true,
          locationLat: true,
          locationLng: true,
        },
      },
    },
  });
  const fieldCheckCopy = copy[locale].revamp.workflow.fieldCheck;
  const howTo = copy[locale].revamp.howTo;
  const flowCopy = copy[locale].flow;
  const funded = await fundedAmountsByConcern(
    db,
    cases.concerns.map((concern) => concern.id)
  );
  const flowHints = new Map(
    cases.concerns.map((concern) => {
      const flow = concernProcessFlow(concern, funded.get(concern.id) ?? 0);
      const current = flow.steps.find((step) => step.key === flow.currentKey);
      return [
        concern.id,
        current
          ? `${
              roleActsOnProcessStep(user.role.key, current.key, {
                block: current.block,
              })
                ? flowCopy.youDoThis
                : flowCopy.notYouTitle
            } · ${flowCopy.steps[current.key].title}`
          : flow.closedUnfounded
            ? flowCopy.unfoundedNote
            : flowCopy.closedNote,
      ];
    })
  );

  const scopeLabel = isOfficial
    ? user.office
      ? t.caseload.replace("{office}", user.office.name)
      : t.noOffice
    : filters.officeId
      ? t.systemFiltered
      : t.systemAll;

  const stats = [
    { label: t.assigned, value: counts.assigned },
    { label: t.pending, value: counts.pending, hint: t.pendingHint },
    { label: t.highPriority, value: counts.highPriority, hint: t.highHint },
    {
      label: t.underAssessment,
      value: counts.underAssessment,
      hint: t.underAssessmentHint,
    },
    {
      label: t.awaitingBudget,
      value: counts.awaitingBudget,
      hint: t.awaitingBudgetHint,
    },
    { label: t.inProgress, value: counts.inProgress },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title={t.welcome.replace("{name}", user.firstName)}
        description={scopeLabel}
      />

      {isOfficial && user.officeId === null ? (
        <Card title={t.noOffice}>
          <p className="text-sm leading-relaxed text-ink-muted">{t.noOfficeHelp}</p>
        </Card>
      ) : null}

      <div className="stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((stat) => (
          <StatCard
            key={stat.label}
            label={stat.label}
            value={stat.value}
            hint={stat.hint}
          />
        ))}
      </div>

      {fieldChecks.length > 0 && (
        <Card
          title={fieldCheckCopy.forYou}
          description={fieldCheckCopy.forYouDesc}
        >
          <ul className="space-y-4">
            {fieldChecks.map((check) => (
              <li
                key={check.id}
                className="space-y-2 rounded-xl border border-line p-4"
              >
                <p className="text-sm font-medium text-ink">
                  {fieldCheckCopy.caseLabel} {check.concern.caseNumber} ·{" "}
                  {check.concern.title}
                </p>
                <p className="text-sm text-ink-subtle">{check.instructions}</p>
                {check.reviewNote && (
                  <p className="rounded-control border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    {fieldCheckCopy.reviewNote}: {check.reviewNote}
                  </p>
                )}
                <FieldCheckSubmitForm
                  checkId={check.id}
                  locale={locale}
                  location={{
                    address: check.concern.locationAddress,
                    purok: check.concern.locationPurok,
                    lat: check.concern.locationLat,
                    lng: check.concern.locationLng,
                    mapUrl: hasCoordinates({
                      lat: check.concern.locationLat,
                      lng: check.concern.locationLng,
                    })
                      ? openStreetMapUrl(
                          check.concern.locationLat as number,
                          check.concern.locationLng as number
                        )
                      : null,
                  }}
                />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title={t.recentResolved} description={t.recentResolvedDesc}>
        {recentlyResolved.length === 0 ? (
          <EmptyState title={t.noResolved} />
        ) : (
          <ul className="divide-y divide-line">
            {recentlyResolved.map((concern) => (
              <li key={concern.id}>
                <Link
                  href={`/official/concerns/${concern.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 py-3 hover:bg-surface-muted"
                >
                  <div>
                    <p className="text-sm font-medium text-ink">
                      {concern.title}
                    </p>
                    <p className="text-xs text-ink-subtle">
                      {concern.caseNumber} · {concern.category.name} ·{" "}
                      {concern.user.firstName} {concern.user.lastName} ·{" "}
                      {concern.resolvedAt
                        ? formatDateTime(concern.resolvedAt)
                        : "—"}
                      {concern.resolutions[0]?.resolutionType
                        ? ` · ${concern.resolutions[0].resolutionType.replaceAll("_", " ").toLowerCase()}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {concern.priorityLevel && (
                      <PriorityBadge level={concern.priorityLevel} />
                    )}
                    <StatusBadge status={concern.status} locale={locale} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={t.searchTitle} description={t.searchDesc}>
        <ConcernFilters
          action="/official"
          locale={locale}
          categories={categories}
          offices={offices}
          showOfficeScope={showOfficeScope}
          defaults={{
            q: firstParam(params, "q"),
            status: firstParam(params, "status"),
            priority: firstParam(params, "priority"),
            categoryId: firstParam(params, "categoryId"),
            officeId: firstParam(params, "officeId"),
            from: firstParam(params, "from"),
            to: firstParam(params, "to"),
          }}
        />
      </Card>

      <Card
        title={
          cases.total === 1
            ? t.casesOne
            : t.casesMany.replace("{count}", String(cases.total))
        }
        description={
          cases.truncated
            ? t.truncated.replace("{count}", String(cases.concerns.length))
            : t.newest
        }
      >
        {cases.concerns.length === 0 ? (
          <EmptyState
            title={t.emptyCaseload}
            description={t.emptyCaseloadHint}
          />
        ) : (
          <div className="overflow-x-auto">
            <table data-stack className="w-full min-w-[760px] text-left text-sm">
              <caption className="sr-only">Cases requiring attention</caption>
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-subtle">
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    {t.caseNo}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    {t.titleCol}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    {t.priorityCol}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    {t.statusCol}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    {t.updatedCol}
                  </th>
                  <th scope="col" className="py-2 font-semibold">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {cases.concerns.map((concern) => (
                  <tr key={concern.id} className="hover:bg-surface-muted">
                    <td data-label={t.caseNo} className="py-3 pr-4 font-mono text-xs text-ink-muted">
                      {concern.caseNumber}
                    </td>
                    <td data-label={t.titleCol} className="py-3 pr-4 font-medium text-ink">
                      {concern.title}
                    </td>
                    <td data-label={t.priorityCol} className="py-3 pr-4">
                      {concern.priorityLevel ? (
                        <PriorityBadge level={concern.priorityLevel} />
                      ) : (
                        <span className="text-ink-faint">{t.notAssessed}</span>
                      )}
                    </td>
                    <td data-label={t.statusCol} className="py-3 pr-4">
                      <StatusBadge status={concern.status} locale={locale} />
                      <p className="mt-1 text-xs font-medium text-brand-800">
                        {flowHints.get(concern.id)}
                      </p>
                      {concern.crew.required !== null && (
                        <p
                          className={`mt-1 text-xs ${
                            concern.crew.satisfied ? "text-ink-muted" : "text-warning"
                          }`}
                        >
                          Crew: {concern.crew.label}
                        </p>
                      )}
                    </td>
                    <td data-label={t.updatedCol} className="py-3 pr-4 text-ink-muted">
                      {formatDate(concern.updatedAt)}
                    </td>
                    <td className="py-3 text-right">
                      <Link
                        href={`/official/concerns/${concern.id}`}
                        className="text-sm font-semibold text-brand-700 hover:text-brand-800"
                      >
                        {t.manage}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-4 border-t border-line pt-4">
          <Button href="/official/concerns" variant="outline" size="sm">
            {t.openFull}
          </Button>
        </div>
      </Card>

      <DeskGuide
        title={t.howToTitle}
        lead={t.howToLead}
        steps={t.howToSteps.map((step, index) => ({
          ...step,
          yoursLabel: index === 2 ? flowCopy.notYouTitle : flowCopy.youDoThis,
          highlight: index !== 2,
        }))}
        mistakesTitle={howTo.ifWrong}
        mistakes={t.howToIfWrong}
        helpLabel={howTo.help}
        hideLabel={howTo.hide}
        showLabel={howTo.show}
        storageKey="br-guide-official"
        defaultOpen={fieldChecks.length === 0 && cases.concerns.length === 0}
      />
    </div>
  );
}
