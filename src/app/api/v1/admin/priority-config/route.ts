import {
  assertSameOrigin,
  createApiError,
  ok,
  parseBody,
  withErrorBoundary,
} from "@/lib/api";
import { requireApiRole } from "@/lib/auth/session";
import { recordAudit, requestMeta } from "@/lib/audit";
import { priorityConfigSchema } from "@/lib/validations/priority";
import {
  loadPriorityConfig,
  savePriorityConfiguration,
} from "@/lib/priority/config";
import {
  validatePriorityConfiguration,
  type FactorConfig,
  type ThresholdConfig,
} from "@/lib/priority/engine";

export const runtime = "nodejs";

export const GET = withErrorBoundary(async () => {
  await requireApiRole(["ADMIN"]);
  const config = await loadPriorityConfig();
  return ok(config);
});

export const PUT = withErrorBoundary(async (req: Request) => {
  assertSameOrigin(req);
  const user = await requireApiRole(["ADMIN"]);
  const body = await parseBody(req, priorityConfigSchema);

  const factors: FactorConfig[] = body.factors.map((f, index) => ({
    key: f.key,
    label: f.label,
    weight: f.weight,
    minScore: f.minScore,
    maxScore: f.maxScore,
    displayOrder: f.displayOrder ?? index + 1,
    isActive: f.isActive ?? true,
  }));
  const thresholds: ThresholdConfig[] = body.thresholds.map((t) => ({
    level: t.level,
    minScore: t.minScore,
    maxScore: t.maxScore,
    label: t.label ?? null,
    isActive: true,
  }));

  const errors = validatePriorityConfiguration(factors, thresholds);
  if (errors.length > 0) {
    throw createApiError.badRequest(errors.join(" "), errors);
  }

  await savePriorityConfiguration({
    thresholds: body.thresholds.map((t) => ({
      level: t.level,
      minScore: t.minScore,
      maxScore: t.maxScore,
      label: t.label ?? null,
    })),
    factors: body.factors.map((f, index) => ({
      key: f.key,
      label: f.label,
      description: f.description ?? null,
      weight: f.weight,
      minScore: f.minScore,
      maxScore: f.maxScore,
      displayOrder: f.displayOrder ?? index + 1,
      isActive: f.isActive ?? true,
    })),
  });

  const meta = requestMeta(req);
  await recordAudit({
    action: "PRIORITY_CONFIG_UPDATED",
    resourceType: "priority_config",
    description: `Updated ${body.thresholds.length} threshold(s) and ${body.factors.length} factor(s).`,
    userId: user.id,
    ...meta,
  });

  const config = await loadPriorityConfig();
  return ok(config);
});
