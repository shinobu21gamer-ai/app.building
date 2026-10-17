import type { MaterialSuggestion } from "@/lib/cases/materials-templates";

// Suggested equipment, chosen from what the concern is actually about.
//
// The assessment form pre-fills its equipment editor with these lines so the
// official names what goes to the site (or is rented, and for how long)
// instead of typing a bare equipment figure nobody can explain afterwards.
// Same signals as the materials templates, most specific first:
//
//   * the resident's category (ROAD, DRAINAGE, STREETLIGHT, WASTE, ...) —
//     the finest answer to "what is this concern about";
//   * the service type the admin set at validation (REPAIR, AYUDA, ...) —
//     the fallback when the category has no template of its own.
//
// Queues that move money but do no works (assistance, documents, fund
// releases) deliberately suggest nothing: the editor then opens empty and
// the official skips equipment instead of inventing it.
//
// The figures are starting points — typical rental/day rates, not
// commitments. The official owns the final list: every line is editable,
// removable, and the equipment total follows the lines.

/** Road patch: heavy gear for a short stretch, rented by the day. */
const ROAD: MaterialSuggestion[] = [
  { name: "Backhoe", quantity: "2", unit: "days", unitPrice: "8000", amount: "16000" },
  { name: "Dump truck", quantity: "2", unit: "days", unitPrice: "6000", amount: "12000" },
  { name: "Concrete mixer", quantity: "2", unit: "days", unitPrice: "1500", amount: "3000" },
  { name: "Plate compactor", quantity: "2", unit: "days", unitPrice: "1200", amount: "2400" },
];

/** Drainage repair: dig, pump the water out, haul the muck away. */
const DRAINAGE: MaterialSuggestion[] = [
  { name: "Backhoe", quantity: "2", unit: "days", unitPrice: "8000", amount: "16000" },
  { name: "Water pump", quantity: "2", unit: "days", unitPrice: "1500", amount: "3000" },
  { name: "Dump truck", quantity: "2", unit: "days", unitPrice: "6000", amount: "12000" },
];

/** Streetlight repair: get a person up to the lamp safely. */
const STREETLIGHT: MaterialSuggestion[] = [
  { name: "Ladder", quantity: "1", unit: "pc", unitPrice: "800", amount: "800" },
  { name: "Service vehicle", quantity: "1", unit: "day", unitPrice: "2500", amount: "2500" },
];

/** Waste collection: the truck, and hand tools for the crew. */
const WASTE: MaterialSuggestion[] = [
  { name: "Dump truck", quantity: "1", unit: "day", unitPrice: "6000", amount: "6000" },
  { name: "Shovel", quantity: "5", unit: "pcs", unitPrice: "350", amount: "1750" },
  { name: "Wheelbarrow", quantity: "2", unit: "pcs", unitPrice: "1200", amount: "2400" },
];

/** Any repair the category does not name: the hall's general works kit. */
const REPAIR: MaterialSuggestion[] = [
  { name: "Concrete mixer", quantity: "1", unit: "day", unitPrice: "1500", amount: "1500" },
  { name: "Ladder", quantity: "1", unit: "pc", unitPrice: "800", amount: "800" },
  { name: "Power drill", quantity: "1", unit: "pc", unitPrice: "600", amount: "600" },
];

/**
 * Money goes out but no equipment is used: the editor opens empty and the
 * official skips equipment.
 */
const NO_EQUIPMENT = new Set(["AYUDA", "DOCUMENTS", "BUDGET"]);

const BY_CATEGORY: Record<string, MaterialSuggestion[]> = {
  ROAD,
  DRAINAGE,
  STREETLIGHT,
  WASTE,
};

const BY_TYPE: Record<string, MaterialSuggestion[]> = {
  REPAIR,
};

/**
 * The suggested equipment for one concern, from what it is about.
 * Returns a fresh array so callers may edit it freely.
 */
export function suggestedEquipment(input: {
  /** The resident's category code (ROAD, DRAINAGE, ...); null when uncategorized. */
  categoryCode: string | null;
  /** The validated service type key (REPAIR, AYUDA, ...); null until set. */
  typeKey: string | null;
}): MaterialSuggestion[] {
  if (input.categoryCode !== null) {
    const byCategory = BY_CATEGORY[input.categoryCode];
    if (byCategory) return byCategory.map((line) => ({ ...line }));
  }
  if (input.typeKey !== null) {
    // Named no-equipment types stop here: falling through to the REPAIR kit
    // would invent a backhoe for a cash assistance.
    if (NO_EQUIPMENT.has(input.typeKey)) return [];
    const byType = BY_TYPE[input.typeKey];
    if (byType) return byType.map((line) => ({ ...line }));
  }
  return [];
}
