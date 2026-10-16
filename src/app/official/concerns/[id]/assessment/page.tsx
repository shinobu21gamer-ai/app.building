import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { AssessmentForm } from "@/components/cases/assessment-form";
import { CrewPanel } from "@/components/cases/crew-panel";
import { PageHeader } from "@/components/ui/page-header";
import { suggestedMaterials } from "@/lib/cases/materials-templates";
import { planNeeds } from "@/lib/cases/plan-needs";
import { formatDateTime } from "@/lib/format";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";

export const metadata: Metadata = {
  title: "Plan the work",
};

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

type MaterialRow = {
  name: string;
  quantity: unknown;
  unit: string | null;
  unitPrice: unknown;
  amount: unknown;
  note: string | null;
};

/**
 * The official's plan: confirm the work, say how many people and how long,
 * then the cost. Crew is picked after the plan is saved — not beside it.
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
      caseAssessment: {
        include: { materials: { orderBy: { sortOrder: "asc" } } },
      },
    },
  });
  if (!concern) notFound();

  const canOverrideShortfall = user.role.key !== "CREW";
  const needs = planNeeds({
    typeKey: concern.type?.key ?? null,
    categoryCode: concern.category?.code ?? null,
    requiresCrew: concern.type?.requiresCrew ?? null,
    requiresBudget: concern.type?.requiresBudget ?? null,
  });
  const planSaved = concern.caseAssessment != null;
  const suggestions = suggestedMaterials({
    categoryCode: concern.category?.code ?? null,
    typeKey: concern.type?.key ?? null,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={concern.caseNumber}
        title={t.assessmentTitle}
        description={t.assessmentDesc}
        actions={
          <>
            <StatusBadge status={concern.status} />
            <Button
              href={`/official/concerns/${concern.id}`}
              variant="outline"
              size="sm"
            >
              {t.backToCase}
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap gap-2 text-sm text-ink-muted">
        <Badge tone="sky">{concern.category.name}</Badge>
        {concern.type && <Badge tone="violet">{concern.type.name}</Badge>}
        {concern.assignedOffice && (
          <span className="self-center">{concern.assignedOffice.name}</span>
        )}
      </div>

      {concern.caseAssessment?.scheduledStartAt && (
        <p className="text-xs text-ink-subtle">
          {t.scheduledStart}:{" "}
          {formatDateTime(concern.caseAssessment.scheduledStartAt)}
          {concern.caseAssessment.scheduledEndAt
            ? ` — ${formatDateTime(concern.caseAssessment.scheduledEndAt)}`
            : ""}
        </p>
      )}

      <div className="mx-auto max-w-3xl space-y-6">
        <Card>
          <AssessmentForm
            concernId={concern.id}
            locale={locale}
            suggestions={needs.materials ? suggestions : []}
            needs={needs}
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
                    materials: (concern.caseAssessment.materials ?? []).map(
                      (line: MaterialRow) => ({
                        name: line.name,
                        quantity: line.quantity ? String(line.quantity) : "",
                        unit: line.unit ?? "",
                        unitPrice: line.unitPrice ? String(line.unitPrice) : "",
                        amount: String(line.amount),
                        note: line.note ?? "",
                      })
                    ),
                  }
                : null
            }
          />
        </Card>

        {needs.crew ? (
          planSaved ? (
            <Card title={t.crewNextTitle} description={t.crewDesc}>
              <CrewPanel
                concernId={concern.id}
                locale={locale}
                canAssign={user.role.key !== "CREW"}
                canOverrideShortfall={canOverrideShortfall}
              />
            </Card>
          ) : (
            <p className="rounded-control border border-dashed border-line bg-surface-sunken px-3 py-3 text-sm text-ink-muted">
              {t.crewAfterPlan}
            </p>
          )
        ) : null}
      </div>
    </div>
  );
}
