import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  assertSameOrigin,
  createApiError,
  ok,
  withErrorBoundary,
} from "@/lib/api";
import { requireApiRole } from "@/lib/auth/session";
import { recordAudit, requestMeta } from "@/lib/audit";
import {
  createConcernSchema,
  type CreateConcernInput,
} from "@/lib/validations/concern";
import { generateCaseNumber } from "@/lib/case-number";
import {
  deleteConcernImage,
  imageUrlForFile,
  readCappedFormData,
  saveConcernImage,
} from "@/lib/uploads";
import {
  evaluatePriority,
  PriorityRuleError,
  type PriorityEvaluation,
} from "@/lib/priority/engine";
import { loadPriorityConfig } from "@/lib/priority/config";
import { routeConcern } from "@/lib/routing/service";
import { notifyConcernSubmitted } from "@/lib/notifications/service";
import { listConcerns, parseConcernFilters } from "@/lib/cases/query";
import { findLikelyDuplicate } from "@/lib/cases/duplicates";

export const runtime = "nodejs";

function isCaseNumberConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== "P2002") return false;
  const target = error.meta?.target;
  if (typeof target === "string") return target.includes("caseNumber");
  if (Array.isArray(target)) return target.includes("caseNumber");
  return false;
}

async function createConcern(
  input: CreateConcernInput,
  userId: number,
  imageUrl: string | null,
  evaluation: PriorityEvaluation,
  duplicateOfId: number | null
) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
        const caseNumber = await generateCaseNumber(tx);

        const concern = await tx.concern.create({
          data: {
            caseNumber,
            userId,
            categoryId: input.categoryId,
            title: input.title,
            description: input.description,
            locationAddress: input.locationAddress,
            locationLat: input.locationLat ?? null,
            locationLng: input.locationLng ?? null,
            imageUrl,
            status: "SUBMITTED",
            priorityLevel: evaluation.level,
            priorityScore: evaluation.totalScore,
            slaDueAt: new Date(Date.now() + Number(process.env.CASE_SLA_HOURS ?? 72) * 60 * 60 * 1000),
            duplicateOfId,
          },
        });

        await tx.caseStatusHistory.create({
          data: {
            concernId: concern.id,
            entryType: "STATUS_CHANGE",
            fromStatus: null,
            toStatus: "SUBMITTED",
            remarks: "Concern submitted by resident.",
            actorId: userId,
            actorRole: "RESIDENT",
          },
        });

        await tx.priorityAssessment.create({
          data: {
            concernId: concern.id,
            urgencyScore: input.urgencyScore,
            impactScore: input.impactScore,
            affectedPopulationScore: input.affectedPopulationScore,
            safetyScore: input.safetyScore,
            totalScore: evaluation.totalScore,
            level: evaluation.level,
            calculationJson: JSON.stringify(evaluation),
            isOverride: false,
            assessedById: null,
          },
        });

        await tx.caseStatusHistory.create({
          data: {
            concernId: concern.id,
            entryType: "PRIORITY_ASSESSED",
            fromStatus: "SUBMITTED",
            toStatus: "SUBMITTED",
            remarks: `Rule-based priority assessed as ${evaluation.level} (total score ${evaluation.totalScore}).`,
            actorRole: "SYSTEM",
          },
        });

        const routing = await routeConcern(tx, {
          id: concern.id,
          categoryId: input.categoryId,
          caseNumber,
        });

        await notifyConcernSubmitted(tx, {
          userId,
          concernId: concern.id,
          caseNumber,
          priorityLevel: evaluation.level,
          officeName: routing.routed ? routing.officeName : null,
        });

        const saved = await tx.concern.findUniqueOrThrow({
          where: { id: concern.id },
        });

        return { concern: saved, routing };
      });
    } catch (error) {
      if (isCaseNumberConflict(error) && attempt < 4) continue;
      throw error;
    }
  }

  throw createApiError.internal("Could not allocate a case number. Please try again.");
}

export const GET = withErrorBoundary(async (req: Request) => {
  const user = await requireApiRole(["OFFICIAL", "ADMIN"]);

  const filters = parseConcernFilters(new URL(req.url).searchParams);

  if (user.role.key === "OFFICIAL") {
    // Officials only ever see cases assigned to their own office.
    if (user.officeId === null) {
      return ok({ concerns: [], total: 0, truncated: false });
    }
    filters.officeId = user.officeId;
  }

  const { concerns, total, truncated } = await listConcerns(filters);

  return ok({
    concerns: concerns.map((concern) => ({
      id: concern.id,
      caseNumber: concern.caseNumber,
      title: concern.title,
      status: concern.status,
      priorityLevel: concern.priorityLevel,
      priorityScore: concern.priorityScore,
      category: { id: concern.category.id, name: concern.category.name },
      resident: {
        id: concern.user.id,
        name: `${concern.user.firstName} ${concern.user.lastName}`,
        email: concern.user.email,
      },
      assignedOffice: concern.assignedOffice
        ? { id: concern.assignedOffice.id, name: concern.assignedOffice.name }
        : null,
      assignedOfficial: concern.assignedOfficial
        ? {
            id: concern.assignedOfficial.id,
            name: `${concern.assignedOfficial.firstName} ${concern.assignedOfficial.lastName}`,
          }
        : null,
      submittedAt: concern.submittedAt,
      createdAt: concern.createdAt,
      updatedAt: concern.updatedAt,
      slaDueAt: concern.slaDueAt,
      slaBreachedAt: concern.slaBreachedAt,
      duplicateOfId: concern.duplicateOfId,
    })),
    total,
    truncated,
  });
});

export const POST = withErrorBoundary(async (req: Request) => {
  assertSameOrigin(req);
  const user = await requireApiRole(["RESIDENT"]);

  const form = await readCappedFormData(req);

  const raw: Record<string, unknown> = {
    title: form.get("title"),
    description: form.get("description"),
    locationAddress: form.get("locationAddress"),
    categoryId: form.get("categoryId"),
  };

  for (const field of ["locationLat", "locationLng"] as const) {
    const value = form.get(field);
    if (typeof value === "string" && value.trim() !== "") raw[field] = value;
  }

  for (const field of [
    "urgencyScore",
    "impactScore",
    "affectedPopulationScore",
    "safetyScore",
  ] as const) {
    const value = form.get(field);
    if (value !== null) raw[field] = value;
  }

  const parsed = createConcernSchema.safeParse(raw);
  if (!parsed.success) throw parsed.error;
  const input = parsed.data;

  const category = await db.concernCategory.findUnique({
    where: { id: input.categoryId },
  });
  if (!category || !category.isActive) {
    throw createApiError.badRequest("Select an active concern category.");
  }

  const { factors, thresholds } = await loadPriorityConfig();
  let evaluation: PriorityEvaluation;
  try {
    evaluation = evaluatePriority(input, factors, thresholds);
  } catch (error) {
    if (error instanceof PriorityRuleError) {
      throw createApiError.badRequest(error.message);
    }
    throw error;
  }

  const imageEntry = form.get("image");
  if (!(imageEntry instanceof File) || imageEntry.size === 0) {
    throw createApiError.badRequest("A proof image is required.");
  }
  const filename = await saveConcernImage(imageEntry, user.id);
  const duplicateOfId = await findLikelyDuplicate({
    userId: user.id,
    categoryId: input.categoryId,
    title: input.title,
    locationAddress: input.locationAddress,
  });

  let created;
  try {
    created = await createConcern(
      input,
      user.id,
      filename ? imageUrlForFile(filename) : null,
      evaluation,
      duplicateOfId
    );
  } catch (error) {
    if (filename) await deleteConcernImage(filename);
    throw error;
  }

  const { concern, routing } = created;

  const meta = requestMeta(req);
  await recordAudit({
    action: routing.routed ? "CONCERN_ROUTED" : "CONCERN_SUBMITTED",
    resourceType: "concern",
    resourceId: String(concern.id),
    description: routing.routed
      ? `Concern ${concern.caseNumber} submitted, assessed ${evaluation.level} (score ${evaluation.totalScore}), routed to ${routing.officeName}.`
      : `Concern ${concern.caseNumber} submitted and assessed ${evaluation.level} (score ${evaluation.totalScore}); no active routing rule matched.`,
    userId: user.id,
    ...meta,
  });

  return ok(
    {
      concern: {
        id: concern.id,
        caseNumber: concern.caseNumber,
        status: concern.status,
        priorityLevel: concern.priorityLevel,
        priorityScore: concern.priorityScore,
        assignedOfficeId: concern.assignedOfficeId,
      },
      priority: {
        totalScore: evaluation.totalScore,
        level: evaluation.level,
        explanation: evaluation.explanation,
      },
      routing: routing.routed
        ? {
            routed: true,
            officeId: routing.officeId,
            officeName: routing.officeName,
            notifiedOfficials: routing.notifiedOfficials,
          }
        : { routed: false, reason: routing.reason },
      redirect: `/resident/concerns/${concern.id}`,
    },
    { status: 201 }
  );
});
