import { describe, expect, it } from "vitest";

import { verificationActorState } from "./verification-rules";

describe("verificationActorState", () => {
  it("lets a colleague with the permission verify", () => {
    expect(
      verificationActorState({ canVerify: true, recordedById: 7, actorId: 9 })
    ).toBe("CAN_VERIFY");
  });

  it("refuses the official who recorded the resolution, whatever their role", () => {
    expect(
      verificationActorState({ canVerify: true, recordedById: 7, actorId: 7 })
    ).toBe("SELF_RECORDED");
    // An administrator or the Captain who recorded it is refused the same way:
    // the server compares the actor id, not the role.
    expect(
      verificationActorState({ canVerify: false, recordedById: 7, actorId: 7 })
    ).toBe("SELF_RECORDED");
  });

  it("keeps a reader without the permission out, recorder or not", () => {
    expect(
      verificationActorState({ canVerify: false, recordedById: 7, actorId: 9 })
    ).toBe("NO_PERMISSION");
  });

  it("matches the server on a resolution with no recorded official", () => {
    // The server compares `officialId === actor.id`; null never matches, so
    // anyone holding the permission may verify such a row.
    expect(
      verificationActorState({ canVerify: true, recordedById: null, actorId: 9 })
    ).toBe("CAN_VERIFY");
    expect(
      verificationActorState({ canVerify: false, recordedById: null, actorId: 9 })
    ).toBe("NO_PERMISSION");
  });
});
