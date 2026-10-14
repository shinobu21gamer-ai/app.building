// Resolution verification rules: pure functions, no database access.
//
// Step 8 of the case flow ("Verify the fix") is the one step the same person
// may not do twice. The official who recorded the resolution cannot verify it
// — that is the whole point of the step — and the server refuses it
// (`verifyResolution` in `service.ts`):
//
//     if (resolution.officialId === input.actor.id) throw forbidden(...)
//
// The screen used to render the form and its button anyway, so the reader got
// the refusal as an error after the click, on a panel whose header said they
// were the one to do it. This module is the same rule, decided from facts
// before anything is drawn, so the panel can name the person who CAN do it
// instead of offering a button that can only fail.

/** Who may record the verification of a case's resolution, and who may not. */
export type VerificationActorState =
  /** Holds `case.resolution.verify` and did not record this resolution. */
  | "CAN_VERIFY"
  /** Recorded this resolution: the server refuses them, whatever their role. */
  | "SELF_RECORDED"
  /** Does not hold `case.resolution.verify` at all. */
  | "NO_PERMISSION";

/**
 * The actor's standing on one resolution.
 *
 * The self-check comes first on purpose: an administrator or the Captain who
 * recorded the resolution is refused by the server exactly like anybody else,
 * so permission alone must never make the form look available to them.
 *
 * A resolution with no recorded official (`recordedById === null` — legacy
 * rows) can be verified by anyone holding the permission, which is what the
 * server's `===` comparison does.
 */
export function verificationActorState(input: {
  /** Whether the actor holds `case.resolution.verify`. */
  canVerify: boolean;
  /** The official on the recorded resolution; null when the row has none. */
  recordedById: number | null;
  /** The actor reading the page. */
  actorId: number;
}): VerificationActorState {
  if (input.recordedById !== null && input.recordedById === input.actorId) {
    return "SELF_RECORDED";
  }
  return input.canVerify ? "CAN_VERIFY" : "NO_PERMISSION";
}

/** A person, as the case sheet loads them: enough to address them by name. */
export type OfficePerson = {
  id: number;
  firstName: string;
  lastName: string;
};

/** "Maria Santos" — the name as a sentence would say it. */
export function fullName(person: OfficePerson): string {
  return `${person.firstName} ${person.lastName}`.trim();
}

/**
 * A sentence's list vocabulary. The join has to be translated like any other
 * copy — "Tanungin si Maria Santos and Juan Cruz" is not Filipino.
 */
type JoinWords = {
  and: string;
  others: (count: number) => string;
};

const JOIN_WORDS: Record<JoinLocale, JoinWords> = {
  en: {
    and: "and",
    others: (count) => `${count} other${count === 1 ? "" : "s"}`,
  },
  fil: {
    and: "at",
    others: (count) => `${count} pang iba`,
  },
};

/** The languages this module can join a list in. Mirrors `Locale`. */
export type JoinLocale = "en" | "fil";

/**
 * Joins names the way a sentence reads: "Ana", "Ana and Ben", "Ana, Ben and
 * Cris", and — past `max` — "Ana, Ben, Cris and 2 others", because a sentence
 * naming nine people is a list, not an instruction.
 */
export function joinNames(
  names: readonly string[],
  options: { locale?: JoinLocale; max?: number } = {}
): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];

  const words = JOIN_WORDS[options.locale ?? "en"];
  const shown = names.slice(0, Math.max(2, options.max ?? 3));
  const rest = names.length - shown.length;
  if (rest > 0) {
    return `${shown.join(", ")} ${words.and} ${words.others(rest)}`;
  }
  return `${shown.slice(0, -1).join(", ")} ${words.and} ${shown[shown.length - 1]}`;
}

/**
 * The people the recorder may actually ask, by name.
 *
 * The blocked notice used to say "a colleague in the office", which is not an
 * instruction anybody can follow — the reader still had to work out who that
 * is. The office's own officials can open the case (the case sheet is scoped
 * to the case's office), so they come first; when that office has nobody else,
 * the Barangay Captain can verify any case and is named instead.
 *
 * The recorder is never in the list: naming the person the server refuses
 * would send the reader straight back into the refusal.
 */
export function verificationAskNames(input: {
  /** Active officials of the office holding the case. */
  colleagues: readonly OfficePerson[];
  /** The official on the recorded resolution; never offered. */
  recordedById: number | null;
  /** A named Barangay Captain, when the barangay has one on file. */
  captain: OfficePerson | null;
}): string[] {
  const colleagues = input.colleagues
    .filter((person) => person.id !== input.recordedById)
    .map(fullName);
  if (colleagues.length > 0) return colleagues;

  const captain = input.captain;
  if (captain === null || captain.id === input.recordedById) return [];
  return [fullName(captain)];
}
