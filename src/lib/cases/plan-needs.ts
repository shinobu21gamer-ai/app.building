// What a case actually needs after the report is typed.
//
// A noise complaint is a talk and a notice, not a dump truck. Documents are
// paper. Ayuda and budget releases move money but do not send a works crew.
// Only repair / public works plans equipment, materials and crew.

export type PlanNeeds = {
  /** Book named crew before work starts. */
  crew: boolean;
  /** Treasury must set money aside. */
  budget: boolean;
  /** The plan must say what tools go to the site. */
  equipment: boolean;
  /** Line-by-line materials to buy. */
  materials: boolean;
};

const NO_WORKS_CATEGORIES = new Set(["NOISE", "DOC_REQUEST"]);
const REPAIR_CATEGORIES = new Set(["ROAD", "DRAINAGE", "STREETLIGHT", "WASTE"]);

const NO_WORKS: PlanNeeds = {
  crew: false,
  budget: false,
  equipment: false,
  materials: false,
};

const MONEY_ONLY: PlanNeeds = {
  crew: false,
  budget: true,
  equipment: false,
  materials: false,
};

const WORKS: PlanNeeds = {
  crew: true,
  budget: true,
  equipment: true,
  materials: true,
};

export function planNeeds(input: {
  typeKey?: string | null;
  categoryCode?: string | null;
  requiresCrew?: boolean | null;
  requiresBudget?: boolean | null;
}): PlanNeeds {
  const type = input.typeKey ?? null;
  const category = input.categoryCode ?? null;

  if (category !== null && NO_WORKS_CATEGORIES.has(category)) return NO_WORKS;
  if (type === "DOCUMENTS") return NO_WORKS;
  if (type === "AYUDA" || type === "BUDGET") return MONEY_ONLY;
  if (type === "REPAIR" || (category !== null && REPAIR_CATEGORIES.has(category))) {
    return WORKS;
  }
  if (input.requiresCrew) return WORKS;
  if (input.requiresBudget) return MONEY_ONLY;
  return NO_WORKS;
}
