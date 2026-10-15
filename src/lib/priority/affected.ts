/**
 * How many people a concern affects, and the band that number scores in.
 *
 * The AFFECTED_POPULATION factor is scored 1–5, which is what the engine sums.
 * "5" is not a limit on the number of people a case may affect — it is the
 * *top band*, and every count from 500 upward lands there. An official who
 * records "how many people are affected?" (250, 1200, …) gets the band computed
 * for them and the real figure stored beside the score, so the case sheet shows
 * the headcount instead of only "5".
 *
 * Pure and framework-free so the banding rules can be unit tested.
 */

export type AffectedBand = {
  /** The factor score this band maps to (the engine's 1–5 scale). */
  score: number;
  /** Lowest count in the band, inclusive. */
  min: number;
  /** Highest count in the band, inclusive; `null` = open-ended top band. */
  max: number | null;
  label: string;
};

export const AFFECTED_BANDS: readonly AffectedBand[] = [
  { score: 1, min: 1, max: 4, label: "1–4 people (one household)" },
  { score: 2, min: 5, max: 19, label: "5–19 people (a few households)" },
  { score: 3, min: 20, max: 99, label: "20–99 people (one purok or street)" },
  { score: 4, min: 100, max: 499, label: "100–499 people (several puroks)" },
  { score: 5, min: 500, max: null, label: "500 or more people (the whole barangay)" },
] as const;

/** The largest count a single entry may record; anything bigger is a typo. */
export const MAX_AFFECTED_PEOPLE = 10_000_000;

/**
 * The band a headcount belongs to.
 *
 * Counts below the first band's floor are treated as the first band rather than
 * rejected: "1 person" is a real answer, and the floor exists to stop zero.
 */
export function affectedBandFromCount(count: number): AffectedBand {
  const top = AFFECTED_BANDS[AFFECTED_BANDS.length - 1];
  if (!Number.isFinite(count)) return top;
  const whole = Math.max(Math.floor(count), 1);
  return (
    AFFECTED_BANDS.find(
      (band) => whole >= band.min && (band.max === null || whole <= band.max)
    ) ?? top
  );
}

/** The score (1–5) a headcount contributes to the priority total. */
export function affectedScoreFromCount(count: number): number {
  return affectedBandFromCount(count).score;
}

/** The band a stored score came from, for showing the range behind a score. */
export function affectedBandFromScore(score: number): AffectedBand | null {
  return AFFECTED_BANDS.find((band) => band.score === score) ?? null;
}

/**
 * The one-line description of what was recorded: "250 people → band 4 of 5
 * (100–499 people)". Used by the case sheet and the override form's hint.
 */
export function describeAffectedPeople(count: number | null | undefined): string | null {
  if (count === null || count === undefined || !Number.isFinite(count)) return null;
  const band = affectedBandFromCount(count);
  return `${count.toLocaleString("en-PH")} people → score ${band.score} of 5 (${band.label})`;
}
