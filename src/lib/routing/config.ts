import { db } from "@/lib/db";

export type LoadRoutingRulesOptions = {
  /** Only rules that can actually match: active rule, active office/category. */
  activeOnly?: boolean;
};

/**
 * Loads routing rules (with their category and office) for administration and
 * for callers that need to inspect the configured routing table.
 */
export async function loadRoutingRules(options: LoadRoutingRulesOptions = {}) {
  return db.routingRule.findMany({
    where: options.activeOnly
      ? {
          isActive: true,
          office: { isActive: true },
          category: { isActive: true },
        }
      : undefined,
    include: { category: true, office: true },
    orderBy: [
      { categoryId: "asc" },
      { priorityOrder: "asc" },
      { id: "asc" },
    ],
  });
}
