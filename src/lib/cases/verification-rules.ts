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
