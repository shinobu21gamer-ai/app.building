// The UNDER_ASSESSMENT record: eligibility, inspection, resources, approval,
// the manpower plan and the cost estimate.
//
// One row per case (CaseAssessment is unique on concernId); every save is
// recorded on the case journal with a MANPOWER_PLAN / ASSESSMENT entry, and the
// audit trail is written by the route. Legacy cases that were never assessed
// stay workable: `legacyCaseNotice` tells the UI what is missing instead of
// blocking the official.

import { refreshCaseLabour } from "@/lib/cases/labour";
import type { Prisma } from "@prisma/client";
import { createApiError } from "@/lib/api";
import { armCaseStageClock } from "@/lib/sla/escalation";
import { canManageConcern, type WorkflowActor } from "@/lib/cases/workflow";
import { planWindowProblem } from "@/lib/cases/plan-window";
import { fieldCheckGateBlock } from "@/lib/cases/field-check-rules";
import {
  isValidDurationMinutes,
  isValidWorkersNeeded,
  type LaborBasis,
  type CostEstimate,
} from "@/lib/cases/manpower";

type Tx = Prisma.TransactionClient;

export type AssessmentInput = {
  eligibilityChecked: boolean;
  eligibilityNotes?: string | null;
  inspectionRequired: boolean;
  inspectionNotes?: string | null;
  inspectionCompleted: boolean;
  resourcesVerified: boolean;
  resourcesVerificationNotes?: string | null;
  approvalRequired: boolean;
  approvalNotes?: string | null;
  approved: boolean;
  workersNeeded: number;
  estimatedDurationMinutes: number;
  equipmentNotes: string;
  scheduledStartAt?: Date | null;
  scheduledEndAt?: Date | null;
  // Cost estimate. Labour is computed from the roster when a rate exists;
  // otherwise the assessor must supply laborCost.
  laborCost?: number | null;
  materialsCost?: number | null;
  equipmentCost?: number | null;
  otherCost?: number | null;
  // The materials list. When present (even empty), the materials total is
  // recomputed from these lines and the stored lines are replaced.
  materials?: MaterialLineInput[] | null;
};

export type MaterialLineInput = {
  name: string;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  amount: number;
  note: string | null;
};

export type AssessmentView = {
  id: number;
  status: string;
  eligibilityChecked: boolean;
  eligibilityNotes: string | null;
  inspectionRequired: boolean;
  inspectionNotes: string | null;
  inspectionCompletedAt: string | null;
  resourcesVerified: boolean;
  resourcesVerificationNotes: string | null;
  approvalRequired: boolean;
  approvalNotes: string | null;
  approvedAt: string | null;
  workersNeeded: number | null;
  estimatedDurationMinutes: number | null;
  equipmentNotes: string | null;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  laborCost: string | null;
  materialsCost: string | null;
  equipmentCost: string | null;
  otherCost: string | null;
  totalCost: string | null;
  currency: string;
  laborCostBasisJson: string | null;
  submittedAt: string | null;
  updatedAt: string;
  materials: AssessmentMaterialView[];
};

/** One stored materials line, as the API serves it. */
export type AssessmentMaterialView = {
  name: string;
  quantity: string | null;
  unit: string | null;
  unitPrice: string | null;
  amount: string;
  note: string | null;
};

function money(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

export type SaveAssessmentOutcome = {
  assessmentId: number;
  concernId: number;
  caseNumber: string;
  status: string;
  fromStatus: string;
  cost: CostEstimate;
  laborBasis: LaborBasis;
  workersNeeded: number;
  legacyCase: boolean;
};

export async function loadConcernForAssessment(
  tx: Tx,
  concernId: number,
  actor: WorkflowActor
) {
  const concern = await tx.concern.findUnique({
    where: { id: concernId },
    select: {
      id: true,
      caseNumber: true,
      status: true,
      assignedOfficeId: true,
      submittedAt: true,
      caseAssessment: {
        select: {
          id: true,
          workersNeeded: true,
          status: true,
          scheduledStartAt: true,
          scheduledEndAt: true,
        },
      },
    },
  });
  if (!concern) throw createApiError.notFound("Concern not found.");
  if (!canManageConcern(actor, concern)) {
    throw createApiError.forbidden("This concern is assigned to another office.");
  }
  if (concern.status === "CLOSED" || concern.status === "RESOLVED") {
    throw createApiError.conflict(
      concern.status === "CLOSED"
        ? "Closed cases cannot be modified."
        : "Resolved cases can no longer be assessed."
    );
  }
  return concern;
}

/**
 * Creates or updates the assessment and its manpower plan. The date the case
 * entered UNDER_ASSESSMENT is recorded the first time an assessment is saved on
 * an ASSIGNED case.
 */
export async function saveAssessment(
  tx: Tx,
  input: { concernId: number; actor: WorkflowActor; values: AssessmentInput }
): Promise<SaveAssessmentOutcome> {
  const concern = await loadConcernForAssessment(tx, input.concernId, input.actor);
  const values = input.values;

  if (!isValidWorkersNeeded(values.workersNeeded)) {
    throw createApiError.badRequest(
      "Workers needed must be a whole number of at least 1."
    );
  }
  if (!isValidDurationMinutes(values.estimatedDurationMinutes)) {
    throw createApiError.badRequest(
      "An estimated duration of at least 15 minutes is required."
    );
  }
  if (!values.equipmentNotes || values.equipmentNotes.trim().length < 3) {
    throw createApiError.badRequest(
      "Equipment notes are required (write \"none\" when no equipment is needed)."
    );
  }
  // The plan is a statement about work still to be done: neither end may be
  // pushed further into the past. A window that is already stored keeps its
  // days, so a case that is running can still be re-saved.
  const planProblem = planWindowProblem({
    scheduledStartAt: values.scheduledStartAt ?? null,
    scheduledEndAt: values.scheduledEndAt ?? null,
    existing: concern.caseAssessment
      ? {
          scheduledStartAt: concern.caseAssessment.scheduledStartAt,
          scheduledEndAt: concern.caseAssessment.scheduledEndAt,
        }
      : null,
  });
  if (planProblem) throw createApiError.badRequest(planProblem);

  const now = new Date();
  const existing = concern.caseAssessment;
  const legacyCase = existing === null;

  // When a materials list is sent (even an empty one), the materials total
  // is the sum of its lines; otherwise the typed figure stands.
  const materialsTotal = values.materials
    ? Math.round(
        values.materials.reduce(
          (sum: number, line: MaterialLineInput) => sum + money(line.amount),
          0
        ) * 100
      ) / 100
    : null;

  const data = {
    status: values.approvalRequired && !values.approved ? "DRAFT" : "SUBMITTED",
    eligibilityChecked: values.eligibilityChecked,
    eligibilityNotes: values.eligibilityNotes ?? null,
    inspectionRequired: values.inspectionRequired,
    inspectionNotes: values.inspectionNotes ?? null,
    inspectionCompletedAt:
      values.inspectionRequired && !values.inspectionCompleted
        ? null
        : now,
    inspectedById: values.inspectionRequired ? input.actor.id : null,
    resourcesVerified: values.resourcesVerified,
    resourcesVerificationNotes: values.resourcesVerificationNotes ?? null,
    resourcesVerifiedAt: values.resourcesVerified ? now : null,
    resourcesVerifiedById: values.resourcesVerified ? input.actor.id : null,
    approvalRequired: values.approvalRequired,
    approvalNotes: values.approvalNotes ?? null,
    approvedAt: values.approvalRequired ? (values.approved ? now : null) : now,
    approvedById: values.approvalRequired ? (values.approved ? input.actor.id : null) : input.actor.id,
    workersNeeded: values.workersNeeded,
    estimatedDurationMinutes: values.estimatedDurationMinutes,
    scheduledStartAt: values.scheduledStartAt ?? null,
    scheduledEndAt: values.scheduledEndAt ?? null,
    equipmentNotes: values.equipmentNotes.trim(),
    materialsCost: materialsTotal ?? money(values.materialsCost),
    equipmentCost: money(values.equipmentCost),
    otherCost: money(values.otherCost),
    submittedAt: existing?.id ? undefined : now,
    updatedById: input.actor.id,
  };

  const assessment = existing
    ? await tx.caseAssessment.update({ where: { id: existing.id }, data })
    : await tx.caseAssessment.create({
        data: { concernId: concern.id, createdById: input.actor.id, ...data },
      });

  // Replace the materials list with what was sent (an empty list clears it).
  if (values.materials) {
    await tx.assessmentMaterial.deleteMany({
      where: { assessmentId: assessment.id },
    });
    if (values.materials.length > 0) {
      await tx.assessmentMaterial.createMany({
        data: values.materials.map(
          (line: MaterialLineInput, index: number) => ({
            assessmentId: assessment.id,
            name: line.name,
            quantity: line.quantity,
            unit: line.unit,
            unitPrice: line.unitPrice,
            amount: money(line.amount),
            note: line.note,
            sortOrder: index,
          })
        ),
      });
    }
  }

  // Labour is priced from the crew actually on the case: no crew, no labour.
  const priced = await refreshCaseLabour(tx, concern.id, {
    manualFigure: money(values.laborCost) > 0 ? money(values.laborCost) : null,
  });
  if (!priced) throw new Error("The assessment was not saved.");
  const cost = priced.cost;
  const labor = { basis: priced.basis };

  // First assessment on an ASSIGNED case moves it into UNDER_ASSESSMENT — and
  // that move is exactly what a requested field check is holding back. The
  // status endpoint enforces the same gate (see `changeConcernStatus`); saving
  // the assessment is the other door into UNDER_ASSESSMENT, so it locks here
  // too. Without this, a case could walk past its own field check.
  let fromStatus = concern.status;
  if (concern.status === "ASSIGNED") {
    const checks = await tx.fieldCheck.findMany({
      where: { concernId: concern.id },
      select: { status: true, finding: true },
    });
    const fieldBlock = fieldCheckGateBlock(checks);
    if (fieldBlock) throw createApiError.badRequest(fieldBlock);
    await tx.concern.update({
      where: { id: concern.id },
      data: { status: "UNDER_ASSESSMENT", stageEnteredAt: now },
    });
    // A new stage gets its own deadline, not the rest of the ASSIGNED window.
    await armCaseStageClock(tx, {
      concernId: concern.id,
      status: "UNDER_ASSESSMENT",
      from: now,
    });
    fromStatus = "ASSIGNED";
    await tx.caseStatusHistory.create({
      data: {
        concernId: concern.id,
        entryType: "STATUS_CHANGE",
        fromStatus: "ASSIGNED",
        toStatus: "UNDER_ASSESSMENT",
        remarks: "Assessment started: eligibility, inspection, resources, approval.",
        visibility: "RESIDENT_VISIBLE",
        actorId: input.actor.id,
        actorRole: input.actor.roleKey,
      },
    });
  }

  await tx.caseStatusHistory.create({
    data: {
      concernId: concern.id,
      entryType: "MANPOWER_PLAN",
      fromStatus: fromStatus,
      toStatus: concern.status === "ASSIGNED" ? "UNDER_ASSESSMENT" : concern.status,
      remarks:
        `Manpower plan: ${values.workersNeeded} worker${
          values.workersNeeded === 1 ? "" : "s"
        }, estimated duration ${values.estimatedDurationMinutes} minutes. ` +
        `Cost estimate ₱${cost.totalCost.toFixed(2)} (labour ₱${cost.laborCost.toFixed(
          2
        )}).`,
      visibility: "RESIDENT_VISIBLE",
      metadataJson: JSON.stringify({
        workersNeeded: values.workersNeeded,
        estimatedDurationMinutes: values.estimatedDurationMinutes,
        equipmentNotes: values.equipmentNotes.trim(),
        cost,
        laborBasis: labor.basis,
        scheduledStartAt: values.scheduledStartAt?.toISOString() ?? null,
        scheduledEndAt: values.scheduledEndAt?.toISOString() ?? null,
      }),
      actorId: input.actor.id,
      actorRole: input.actor.roleKey,
    },
  });

  return {
    assessmentId: assessment.id,
    concernId: concern.id,
    caseNumber: concern.caseNumber,
    status: assessment.status,
    fromStatus,
    cost,
    laborBasis: labor.basis,
    workersNeeded: values.workersNeeded,
    legacyCase,
  };
}

export function assessmentView(row: {
  id: number;
  status: string;
  eligibilityChecked: boolean;
  eligibilityNotes: string | null;
  inspectionRequired: boolean;
  inspectionNotes: string | null;
  inspectionCompletedAt: Date | null;
  resourcesVerified: boolean;
  resourcesVerificationNotes: string | null;
  approvalRequired: boolean;
  approvalNotes: string | null;
  approvedAt: Date | null;
  workersNeeded: number | null;
  estimatedDurationMinutes: number | null;
  equipmentNotes: string | null;
  scheduledStartAt: Date | null;
  scheduledEndAt: Date | null;
  laborCost: unknown;
  materialsCost: unknown;
  equipmentCost: unknown;
  otherCost: unknown;
  totalCost: unknown;
  currency: string;
  laborCostBasisJson: string | null;
  submittedAt: Date | null;
  updatedAt: Date;
  materials?: {
    name: string;
    quantity: unknown;
    unit: string | null;
    unitPrice: unknown;
    amount: unknown;
    note: string | null;
  }[];
}): AssessmentView {
  const decimal = (value: unknown): string | null =>
    value === null || value === undefined ? null : String(value);

  return {
    id: row.id,
    status: row.status,
    eligibilityChecked: row.eligibilityChecked,
    eligibilityNotes: row.eligibilityNotes,
    inspectionRequired: row.inspectionRequired,
    inspectionNotes: row.inspectionNotes,
    inspectionCompletedAt: row.inspectionCompletedAt?.toISOString() ?? null,
    resourcesVerified: row.resourcesVerified,
    resourcesVerificationNotes: row.resourcesVerificationNotes,
    approvalRequired: row.approvalRequired,
    approvalNotes: row.approvalNotes,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    workersNeeded: row.workersNeeded,
    estimatedDurationMinutes: row.estimatedDurationMinutes,
    equipmentNotes: row.equipmentNotes,
    scheduledStartAt: row.scheduledStartAt?.toISOString() ?? null,
    scheduledEndAt: row.scheduledEndAt?.toISOString() ?? null,
    laborCost: decimal(row.laborCost),
    materialsCost: decimal(row.materialsCost),
    equipmentCost: decimal(row.equipmentCost),
    otherCost: decimal(row.otherCost),
    totalCost: decimal(row.totalCost),
    currency: row.currency,
    laborCostBasisJson: row.laborCostBasisJson,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
    materials: (row.materials ?? []).map((line) => ({
      name: line.name,
      quantity: decimal(line.quantity),
      unit: line.unit,
      unitPrice: decimal(line.unitPrice),
      amount: String(line.amount),
      note: line.note,
    })),
  };
}
