import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
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
import { affectedScoreFromCount } from "@/lib/priority/affected";
import { holdForValidation } from "@/lib/routing/service";
import { notifyConcernSubmitted } from "@/lib/notifications/service";
import { assertConsent } from "@/lib/privacy/consent";
import { listConcerns, parseConcernFilters } from "@/lib/cases/query";
import {
  decideDuplicateSubmission,
  findLikelyDuplicate,
} from "@/lib/cases/duplicates";
import { resolveStageWindow } from "@/lib/sla/escalation";
import { slaDueAt } from "@/lib/sla/policy";
import { encodeGeohash } from "@/lib/cases/geo";
import {
  checkConcernSubmissionAllowed,
  recordConcernSubmission,
} from "@/lib/rate-limit";
import { assertIdentityGate } from "@/lib/identity/verification";

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
  // Internal precision (≈150 m) for clustering; the public projection coarsens
  // this to a 5-character geohash before anything is published.
  const locationGeohash =
    input.locationLat !== undefined && input.locationLng !== undefined
      ? encodeGeohash(input.locationLat, input.locationLng, 7)
      : null;

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
        const caseNumber = await generateCaseNumber(tx);

        // The 48-hour clock starts now, under the policy that governs the
        // SUBMITTED stage for this type and priority (see src/lib/sla/).
        const window = await resolveStageWindow(tx, {
          stage: "SUBMITTED",
          typeId: input.typeId ?? null,
          priorityLevel: evaluation.level,
        });
        const dueAt = slaDueAt(new Date(), window.hours);

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
            locationAccuracyM: input.locationAccuracyM ?? null,
            locationSource: input.locationSource ?? null,
            locationPurok: input.locationPurok ?? null,
            locationGeohash,
            typeId: input.typeId ?? null,
            imageUrl,
            status: "SUBMITTED",
            priorityLevel: evaluation.level,
            priorityScore: evaluation.totalScore,
            slaPolicyId: window.policy?.id ?? null,
            slaDueAt: dueAt,
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

        // Admin validation comes first: the case is held, not assigned.
        const routing = await holdForValidation(tx, {
          id: concern.id,
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
      return ok({
        concerns: [],
        total: 0,
        truncated: false,
        page: 1,
        pageCount: 1,
        hasNextPage: false,
        hasPrevPage: false,
      });
    }
    filters.officeId = user.officeId;
  }

  const { concerns, total, truncated, page, pageCount, hasNextPage, hasPrevPage } =
    await listConcerns(filters);

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
            email: concern.assignedOfficial.email,
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
    page,
    pageCount,
    hasNextPage,
    hasPrevPage,
  });
});

export const POST = withErrorBoundary(async (req: Request) => {
  assertSameOrigin(req);
  const url = new URL(req.url);
  const anonymous = url.searchParams.get("anonymous") === "1";
  const { ip } = requestMeta(req);

  let user;
  if (anonymous) {
    // The anonymous path hands out a brand-new tracking account on every
    // call, so a per-account submission cap can never bind here — check the
    // IP bucket *before* creating that account (and the bcrypt hash that
    // goes with it), so a scripted flood cannot even pay for a throwaway
    // user row, let alone a concern.
    const submissionCheck = await checkConcernSubmissionAllowed(null, ip);
    if (!submissionCheck.allowed) {
      throw createApiError.tooManyRequests(
        `Too many concern submissions from this connection. Try again in ${submissionCheck.retryAfterSeconds} seconds, or sign in to submit.`,
        submissionCheck.retryAfterSeconds ?? undefined
      );
    }
    await recordConcernSubmission(null, ip);

    const residentRole = await db.role.findUnique({ where: { key: "RESIDENT" } });
    if (!residentRole) throw createApiError.internal("Resident role is not configured.");
    const trackingEmail = `anonymous-${crypto.randomUUID()}@anonymous.local`;
    const passwordHash = await bcrypt.hash(crypto.randomUUID(), 10);
    user = await db.user.create({
      data: {
        email: trackingEmail,
        passwordHash,
        firstName: "Anonymous",
        lastName: "Resident",
        roleId: residentRole.id,
        isActive: true,
      },
    });
  } else {
    user = await requireApiRole(["RESIDENT"]);
    const submissionCheck = await checkConcernSubmissionAllowed(user.id, ip);
    if (!submissionCheck.allowed) {
      throw createApiError.tooManyRequests(
        `Too many concern submissions. Try again in ${submissionCheck.retryAfterSeconds} seconds.`,
        submissionCheck.retryAfterSeconds ?? undefined
      );
    }
    await recordConcernSubmission(user.id, ip);
    await assertConsent(
      user.id,
      "DATA_PROCESSING",
      "Your consent to process your data is missing, so this concern cannot be filed. Grant it under \"Your data, your rights\" (/privacy/requests), then submit again — the submit page shows the same button."
    );
  }

  const form = await readCappedFormData(req);

  const raw: Record<string, unknown> = {
    title: form.get("title"),
    description: form.get("description"),
    locationAddress: form.get("locationAddress"),
    categoryId: form.get("categoryId"),
  };

  for (const field of [
    "locationLat",
    "locationLng",
    "locationAccuracyM",
    "locationSource",
    "locationPurok",
    "typeId",
  ] as const) {
    const value = form.get(field);
    if (typeof value === "string" && value.trim() !== "") raw[field] = value;
  }

  for (const field of [
    "urgencyScore",
    "impactScore",
    "affectedPopulationScore",
    "safetyScore",
    "affectedPeople",
  ] as const) {
    const value = form.get(field);
    if (value !== null) raw[field] = value;
  }

  const parsed = createConcernSchema.safeParse(raw);
  if (!parsed.success) throw parsed.error;
  // "How many people are affected?" is answered with a headcount, and the score
  // the engine sums is the band that count falls in (see
  // `@/lib/priority/affected`). Everything downstream — the engine, the stored
  // assessment row, the case sheet — reads this one number, so a case affecting
  // 800 people scores in the top band without losing the figure.
  let input = parsed.data.affectedPeople
    ? {
        ...parsed.data,
        affectedPopulationScore: affectedScoreFromCount(
          parsed.data.affectedPeople
        ),
      }
    : parsed.data;

  const category = await db.concernCategory.findUnique({
    where: { id: input.categoryId },
    include: { type: { select: { key: true, isActive: true } } },
  });
  if (!category || !category.isActive) {
    throw createApiError.badRequest("Select an active concern category.");
  }

  // A suggested service type drives routing; an admin still confirms it during
  // validation, so a wrong suggestion costs a correction, not a misroute.
  let typeKey: string | null =
    category.type?.isActive === false ? null : (category.type?.key ?? null);
  if (input.typeId !== undefined) {
    const type = await db.concernType.findUnique({
      where: { id: input.typeId },
      select: { id: true, isActive: true, key: true },
    });
    if (!type || !type.isActive) {
      throw createApiError.badRequest("Select an active concern type.");
    }
    typeKey = type.key;
  }
  // Assistance and budget concerns release money. The gate is documented on
  // the verification page and in the admin setting; enforce it here so a
  // resident cannot skip it by posting the form directly.
  await assertIdentityGate(user.id, typeKey);

  const { factors, thresholds } = await loadPriorityConfig();
  // The bands assume the standard 1–5 scale. If an administrator configured a
  // narrower range for this factor, the derived score is clamped onto it
  // ("500 or more people" then simply scores the top of that scale) instead of
  // failing the resident's whole submission.
  const populationFactor = factors.find((f) => f.key === "AFFECTED_POPULATION");
  if (
    input.affectedPeople !== undefined &&
    populationFactor &&
    populationFactor.isActive !== false
  ) {
    const score = affectedScoreFromCount(input.affectedPeople);
    const clamped = Math.min(
      Math.max(score, populationFactor.minScore),
      populationFactor.maxScore
    );
    if (clamped !== input.affectedPopulationScore) {
      input = { ...input, affectedPopulationScore: clamped };
    }
  }
  let evaluation: PriorityEvaluation;
  try {
    evaluation = evaluatePriority(input, factors, thresholds);
    if (input.affectedPeople) {
      evaluation = { ...evaluation, affectedPeople: input.affectedPeople };
    }
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
  const duplicate = await findLikelyDuplicate({
    userId: user.id,
    categoryId: input.categoryId,
    title: input.title,
    locationAddress: input.locationAddress,
  });
  const allowPossibleDuplicate = form.get("allowPossibleDuplicate") === "true";
  const duplicateDecision = decideDuplicateSubmission(
    duplicate,
    allowPossibleDuplicate
  );
  if (duplicateDecision.kind === "REVIEW") {
    await deleteConcernImage(filename);
    const match = duplicateDecision.match;
    throw createApiError.possibleDuplicate(
      match.sameResident
        ? {
            sameResident: true,
            concernId: match.id,
            caseNumber: match.caseNumber,
            title: match.title,
            status: match.status,
          }
        : { sameResident: false }
    );
  }

  // A resident who confirms this is a separate issue must not have it marked
  // as a duplicate: duplicate cases are excluded from SLA monitoring.
  const duplicateOfId = duplicateDecision.duplicateOfId;
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
      : `Concern ${concern.caseNumber} submitted and assessed ${evaluation.level} (score ${evaluation.totalScore}); awaiting admin validation.`,
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
        typeId: concern.typeId,
        locationPurok: concern.locationPurok,
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
      redirect: anonymous ? `/track?case=${concern.caseNumber}` : `/resident/concerns/${concern.id}`,
    },
    { status: 201 }
  );
});
