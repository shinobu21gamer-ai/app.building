// Suggested materials, chosen from what the concern is actually about.
//
// The assessment form pre-fills its materials editor with these lines so the
// official adjusts figures instead of typing the list from scratch. Two
// signals, most specific first:
//
//   * the resident's category (ROAD, DRAINAGE, STREETLIGHT, WASTE, ...) —
//     the finest answer to "what is this concern about";
//   * the service type the admin set at validation (REPAIR, AYUDA, ...) —
//     the fallback when the category has no template of its own.
//
// Types that pay money but buy nothing (assistance, documents, fund
// releases) deliberately suggest nothing: the editor then opens empty and
// the official skips materials instead of inventing them.
//
// The figures are starting points — realistic street prices, not
// commitments. The official owns the final list: every line is editable,
// removable, and the total follows the lines.

export type MaterialSuggestion = {
  name: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  amount: string;
};

const CEMENT_50KG = "Cement (50kg bag)";
const GRAVEL = "Gravel";
const SAND = "Sand";

/** Road patch: cement, gravel and sand for a short stretch of road. */
const ROAD: MaterialSuggestion[] = [
  { name: CEMENT_50KG, quantity: "40", unit: "bags", unitPrice: "550", amount: "22000" },
  { name: GRAVEL, quantity: "10", unit: "cubic meters", unitPrice: "1200", amount: "12000" },
  { name: SAND, quantity: "6", unit: "cubic meters", unitPrice: "600", amount: "3600" },
];

/** Drainage repair: the same mix, on a smaller scale. */
const DRAINAGE: MaterialSuggestion[] = [
  { name: GRAVEL, quantity: "5", unit: "cubic meters", unitPrice: "1200", amount: "6000" },
  { name: CEMENT_50KG, quantity: "15", unit: "bags", unitPrice: "550", amount: "8250" },
  { name: SAND, quantity: "4", unit: "cubic meters", unitPrice: "600", amount: "2400" },
];

/** Streetlight repair: lamps and drivers for a handful of units. */
const STREETLIGHT: MaterialSuggestion[] = [
  { name: "LED street light (150W)", quantity: "5", unit: "pcs", unitPrice: "1800", amount: "9000" },
  { name: "Lamp driver", quantity: "5", unit: "pcs", unitPrice: "600", amount: "3000" },
  { name: "Conduit pipe (100cm)", quantity: "6", unit: "pcs", unitPrice: "350", amount: "2100" },
];

/** Waste management: the consumables the crew goes through. */
const WASTE: MaterialSuggestion[] = [
  { name: "Garbage bags (roll of 50)", quantity: "10", unit: "rolls", unitPrice: "120", amount: "1200" },
  { name: "Work gloves (box)", quantity: "10", unit: "boxes", unitPrice: "150", amount: "1500" },
];

/** Any repair the category does not name: a modest general public-works mix. */
const REPAIR: MaterialSuggestion[] = [
  { name: CEMENT_50KG, quantity: "20", unit: "bags", unitPrice: "550", amount: "11000" },
  { name: GRAVEL, quantity: "5", unit: "cubic meters", unitPrice: "1200", amount: "6000" },
  { name: "Paint (20L pail)", quantity: "2", unit: "pails", unitPrice: "2200", amount: "4400" },
];

/**
 * Money goes out but nothing is bought: the editor opens empty and the
 * official skips materials.
 */
const NO_MATERIALS = new Set(["AYUDA", "DOCUMENTS", "BUDGET"]);

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
 * The suggested materials for one concern, from what it is about.
 * Returns a fresh array so callers may edit it freely.
 */
export function suggestedMaterials(input: {
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
    // Named no-materials types stop here: falling through to the REPAIR mix
    // would invent cement for a cash assistance.
    if (NO_MATERIALS.has(input.typeKey)) return [];
    const byType = BY_TYPE[input.typeKey];
    if (byType) return byType.map((line) => ({ ...line }));
  }
  return [];
}
