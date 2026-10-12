import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { AssessmentForm } from "@/components/cases/assessment-form";
import { CrewPanel } from "@/components/cases/crew-panel";
import { caseWorkflowFlags } from "@/lib/cases/workflow";
import { formatDate, formatDateTime } from "@/lib/format";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";

export const metadata: Metadata = {
  title: "Assessment and crew",
};

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

/**
 * The UNDER_ASSESSMENT desk: evaluation and approval, the manpower plan, the
 * labour-inclusive estimate, and the crew who will do the work. Officials see
 * only their own office's cases.
 */
export default async function AssessmentPage({ params }: PageProps) {
  const user = await requirePermission("case.assess");
  const locale = await getLocale();
  const t = copy[locale].revamp.workflow;
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) notFound();

  const concern = await db.concern.findFirst({
    where:
      user.role.key === "ADMIN" || user.role.key === "CAPTAIN"
        ? { id: numericId }
        : { id: numericId, assignedOfficeId: user.officeId ?? -1 },
    include: {
      category: true,
      type: true,
      assignedOffice: { select: { id: true, name: true } },
      caseAssessment: true,
      crewAssignments: { where: { isActive: true }, select: { id: true } },
    },
  });
  if (!concern) notFound();

  const flags = caseWorkflowFlags({
    status: concern.status,
    workersNeeded: concern.caseAssessment?.workersNeeded ?? null,
    activeCrew: concern.crewAssignments.length,
  });

  const canOverrideShortfall = user.role.key !== "CREW";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {concern.caseNumber}
          </p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">
            {t.assessmentTitle}
          </h1>
          <p className="mt-1 text-sm text-slate-600">{t.assessmentDesc}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <StatusBadge status={concern.status} />
          <Button href={`/official/concerns/${concern.id}`} variant="outline" size="sm">
            {t.viewAssessment}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-sm text-slate-600">
        <Badge tone="sky">{concern.category.name}</Badge>
        {concern.type && <Badge tone="violet">{concern.type.name}</Badge>}
        {concern.assignedOffice && (
          <span className="self-center">{concern.assignedOffice.name}</span>
        )}
        <span className="self-center">
          {t.crewProgress}: {flags.crewProgressLabel}
        </span>
      </div>

      {concern.caseAssessment?.scheduledStartAt && (
        <p className="text-xs text-slate-500">
          {t.scheduledStart}:{" "}
          {formatDateTime(concern.caseAssessment.scheduledStartAt)}
          {concern.caseAssessment.scheduledEndAt
            ? ` — ${formatDateTime(concern.caseAssessment.scheduledEndAt)}`
            : ""}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={t.assessmentTitle} description={t.assessmentDesc}>
          <AssessmentForm
            concernId={concern.id}
            locale={locale}
            legacyCase={flags.legacy}
            defaults={
              concern.caseAssessment
                ? {
                    eligibilityChecked: concern.caseAssessment.eligibilityChecked,
                    eligibilityNotes: concern.caseAssessment.eligibilityNotes,
                    inspectionRequired: concern.caseAssessment.inspectionRequired,
                    inspectionNotes: concern.caseAssessment.inspectionNotes,
                    inspectionCompleted:
                      concern.caseAssessment.inspectionCompletedAt !== null,
                    resourcesVerified: concern.caseAssessment.resourcesVerified,
                    resourcesVerificationNotes:
                      concern.caseAssessment.resourcesVerificationNotes,
                    approvalRequired: concern.caseAssessment.approvalRequired,
                    approvalNotes: concern.caseAssessment.approvalNotes,
                    approved: concern.caseAssessment.approvedAt !== null,
                    workersNeeded: concern.caseAssessment.workersNeeded,
                    estimatedDurationMinutes:
                      concern.caseAssessment.estimatedDurationMinutes,
                    equipmentNotes: concern.caseAssessment.equipmentNotes,
                    scheduledStartAt:
                      concern.caseAssessment.scheduledStartAt?.toISOString() ?? null,
                    scheduledEndAt:
                      concern.caseAssessment.scheduledEndAt?.toISOString() ?? null,
                    laborCost: concern.caseAssessment.laborCost?.toString() ?? null,
                    materialsCost:
                      concern.caseAssessment.materialsCost?.toString() ?? null,
                    equipmentCost:
                      concern.caseAssessment.equipmentCost?.toString() ?? null,
                    otherCost: concern.caseAssessment.otherCost?.toString() ?? null,
                  }
                : null
            }
          />
        </Card>

        <div className="space-y-6">
          <Card title={t.crewTitle} description={t.crewDesc}>
            <CrewPanel
              concernId={concern.id}
              locale={locale}
              canAssign={user.role.key !== "CREW"}
              canOverrideShortfall={canOverrideShortfall}
            />
          </Card>

          {concern.caseAssessment && (
            <Card title={t.costTitle} description={t.costDesc}>
              <dl className="space-y-2 text-sm">
                {(
                  [
                    [t.labor, concern.caseAssessment.laborCost],
                    [t.materials, concern.caseAssessment.materialsCost],
                    [t.equipmentCost, concern.caseAssessment.equipmentCost],
                    [t.other, concern.caseAssessment.otherCost],
                    [t.estimate, concern.caseAssessment.totalCost],
                  ] as Array<[string, unknown]>
                ).map(([label, value]) => (
                  <div key={String(label)} className="flex justify-between gap-3">
                    <dt className="text-slate-500">{label}</dt>
                    <dd className="font-medium tabular-nums text-slate-900">
                      ₱{Number(value ?? 0).toFixed(2)}
                    </dd>
                  </div>
                ))}
                <div className="flex justify-between gap-3 border-t border-slate-100 pt-2 text-xs text-slate-500">
                  <dt>{t.workersNeeded}</dt>
                  <dd>
                    {concern.caseAssessment.workersNeeded ?? "—"} ·{" "}
                    {concern.caseAssessment.estimatedDurationMinutes ?? 0} min
                  </dd>
                </div>
                {concern.caseAssessment.submittedAt && (
                  <div className="flex justify-between gap-3 text-xs text-slate-500">
                    <dt>{copy[locale].revamp.common.date}</dt>
                    <dd>{formatDate(concern.caseAssessment.submittedAt)}</dd>
                  </div>
                )}
              </dl>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
