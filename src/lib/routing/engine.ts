export type RoutingRuleCandidate = {
  id: number;
  categoryId: number;
  officeId: number;
  priorityOrder: number;
  isActive: boolean;
  officeIsActive?: boolean;
};

/**
 * Selects the routing rule that should handle a category. Rules are matched by
 * category and ordered by `priorityOrder` (then id for a stable tie-break), so
 * a category can define a primary office plus fallbacks. Inactive rules and
 * rules pointing at inactive offices are ignored.
 *
 * Pure and framework-free so the selection logic can be unit tested in
 * isolation from the database.
 */
export function selectRoutingRule(
  candidates: RoutingRuleCandidate[],
  categoryId: number
): RoutingRuleCandidate | null {
  const matching = candidates
    .filter(
      (rule) =>
        rule.categoryId === categoryId &&
        rule.isActive !== false &&
        rule.officeIsActive !== false
    )
    .sort(
      (a, b) => a.priorityOrder - b.priorityOrder || a.id - b.id
    );

  return matching[0] ?? null;
}
