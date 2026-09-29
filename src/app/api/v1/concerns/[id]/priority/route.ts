import { db } from "@/lib/db";
import {
  assertSameOrigin,
  createApiError,
  ok,
  parseBody,
  withErrorBoundary,
} from "@/lib/api";
import { requireApiRole } from "@/lib/auth/session";
import { recordAudit, requestMeta } from "@/lib/audit";
import { priorityOverrideSchema } from "@/lib/validations/priority";
import {
  evaluatePriority,
  PriorityRuleError,
  type FactorConfig,
  type FactorKey,
} from "@/lib/priority/engine";
import { loadPriorityConfig } from "@/lib/priority/config";
import { canManageConcern } from "@/lib/cases/workflow";
import { notifyPriorityChanged } from "@/lib/notifications/service";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export const POST = withErrorBoundary<[Request, RouteContext]>(
  async (req, ctx) => {
    assertSameOrigin(req);
    const user = await requireApiRole(["OFFICIAL", "ADMIN"]);

    const { id } = await ctx.params;
    const concernId = Number(id);
    if (!Number.isInteger(concernId) || concernId <= 0) {
      throw createApiError.notFound("Concern not found.");
    }

    const input = await parseBody(req, priorityOverrideSchema);

    const concern = await db.concern.findUnique({
      where: { id: concernId },
      include: {
        assessments: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    if (!concern) throw createApiError.notFound("Concern not found.");

    if (
      !canManageConcern(
        { id: user.id, roleKey: user.role.key, officeId: user.officeId ?? null },
        { assignedOfficeId: concern.assignedOfficeId }
      )
    ) {
      throw createApiError.forbidden(
        "This concern is assigned to another office."
      );
    }

    if (concern.status === "CLOSED" || concern.status === "RESOLVED") {
      throw createApiError.conflict(
        concern.status === "CLOSED"
          ? "Closed cases cannot be modified."
          : "Resolved cases can no longer be modified."
      );
    }

    const latest = concern.assessments[0] ?? null;
    const { factors, thresholds } = await loadPriorityConfig();
    const factorByKey = new Map<string, FactorConfig>(
      factors.map((f) => [f.key, f])
    );
    const minScoreFor = (key: FactorKey, fallback: number) =>
      factorByKey.get(key)?.minScore ?? fallback;

    const scores = {
      urgencyScore:
        input.urgencyScore ??
        latest?.urgencyScore ??
        minScoreFor("URGENCY", 1),
      impactScore:
        input.impactScore ?? latest?.impactScore ?? minScoreFor("IMPACT", 1),
      affectedPopulationScore:
        input.affectedPopulationScore ??
        latest?.affectedPopulationScore ??
        minScoreFor("AFFECTED_POPULATION", 1),
      safetyScore:
        input.safetyScore ?? latest?.safetyScore ?? minScoreFor("SAFETY", 1),
    };

    let evaluation;
    try {
      evaluation = evaluatePriority(scores, factors, thresholds);
    } catch (error) {
      if (error instanceof PriorityRuleError) {
        throw createApiError.badRequest(error.message);
      }
      throw error;
    }

    let finalLevel = evaluation.level;
    if (input.levelOverride) {
      const validLevels = thresholds
        .filter((t) => t.isActive !== false)
        .map((t) => t.level);
      if (!validLevels.includes(input.levelOverride)) {
        throw createApiError.badRequest(
          `"${input.levelOverride}" is not a configured priority level.`
        );
      }
      finalLevel = input.levelOverride;
    }

    const previousLevel = concern.priorityLevel;
    const previousScore = concern.priorityScore;

    const snapshot = {
      ...evaluation,
      level: finalLevel,
      override: {
        isOverride: true,
        recommendedLevel: evaluation.level,
        appliedLevel: finalLevel,
        reason: input.reason,
        overriddenById: user.id,
      },
    };

    const result = await db.$transaction(async (tx) => {
      const assessment = await tx.priorityAssessment.create({
        data: {
          concernId: concern.id,
          urgencyScore: scores.urgencyScore,
          impactScore: scores.impactScore,
          affectedPopulationScore: scores.affectedPopulationScore,
          safetyScore: scores.safetyScore,
          totalScore: evaluation.totalScore,
          level: finalLevel,
          calculationJson: JSON.stringify(snapshot),
          isOverride: true,
          assessedById: user.id,
          overriddenById: user.id,
          overrideReason: input.reason,
        },
      });

      await tx.concern.update({
        where: { id: concern.id },
        data: {
          priorityLevel: finalLevel,
          priorityScore: evaluation.totalScore,
        },
      });

      await tx.caseStatusHistory.create({
        data: {
          concernId: concern.id,
          entryType: "PRIORITY_OVERRIDE",
          fromStatus: concern.status,
          toStatus: concern.status,
          remarks:
            `Priority ${previousLevel ?? "unassessed"}${
              previousScore !== null ? ` (score ${previousScore})` : ""
            } overridden to ${finalLevel} (score ${evaluation.totalScore}). ` +
            `Reason: ${input.reason}`,
          actorId: user.id,
          actorRole: user.role.key,
        },
      });

      await notifyPriorityChanged(tx, {
        userId: concern.userId,
        concernId: concern.id,
        caseNumber: concern.caseNumber,
        level: finalLevel,
      });

      return assessment;
    });

    const meta = requestMeta(req);
    await recordAudit({
      action: "PRIORITY_OVERRIDE",
      resourceType: "concern",
      resourceId: String(concern.id),
      description: `Priority overridden to ${finalLevel} (score ${evaluation.totalScore}) for ${concern.caseNumber}.`,
      userId: user.id,
      ...meta,
    });

    return ok({
      assessment: {
        id: result.id,
        level: result.level,
        totalScore: result.totalScore,
        isOverride: true,
      },
      explanation: evaluation.explanation,
      redirect: `/official/concerns/${concern.id}`,
    });
  }
);
