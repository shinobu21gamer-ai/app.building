import { describe, expect, it } from "vitest";

import {
  fullName,
  joinNames,
  verificationActorState,
  verificationAskNames,
  type OfficePerson,
} from "./verification-rules";

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

const person = (id: number, firstName: string, lastName: string): OfficePerson => ({
  id,
  firstName,
  lastName,
});

describe("fullName", () => {
  it("reads as a sentence would say the name", () => {
    expect(fullName(person(1, "Maria", "Santos"))).toBe("Maria Santos");
    expect(fullName(person(2, "Juan", ""))).toBe("Juan");
  });
});

describe("joinNames", () => {
  it("says one name as itself", () => {
    expect(joinNames(["Maria Santos"])).toBe("Maria Santos");
  });

  it("joins two with 'and', and three with commas and 'and'", () => {
    expect(joinNames(["Ana", "Ben"])).toBe("Ana and Ben");
    expect(joinNames(["Ana", "Ben", "Cris"])).toBe("Ana, Ben and Cris");
  });

  it("turns a long list into an instruction, not a roster", () => {
    expect(joinNames(["Ana", "Ben", "Cris", "Dee", "Eve"])).toBe(
      "Ana, Ben, Cris and 2 others"
    );
    expect(joinNames(["Ana", "Ben", "Cris", "Dee"])).toBe(
      "Ana, Ben, Cris and 1 other"
    );
  });

  it("has nothing to say about nobody", () => {
    expect(joinNames([])).toBe("");
  });

  it("joins in the reader's language", () => {
    expect(joinNames(["Maria", "Juan"], { locale: "fil" })).toBe(
      "Maria at Juan"
    );
    expect(joinNames(["Ana", "Ben", "Cris"], { locale: "fil" })).toBe(
      "Ana, Ben at Cris"
    );
    expect(
      joinNames(["Ana", "Ben", "Cris", "Dee", "Eve"], { locale: "fil" })
    ).toBe("Ana, Ben, Cris at 2 pang iba");
  });
});

describe("verificationAskNames", () => {
  const colleagues = [
    person(1, "Maria", "Santos"),
    person(2, "Juan", "Cruz"),
  ];
  const captain = person(9, "Rosa", "Dizon");

  it("names the office's officials when there are any", () => {
    expect(
      verificationAskNames({ colleagues, recordedById: 3, captain })
    ).toEqual(["Maria Santos", "Juan Cruz"]);
  });

  it("never names the recorder, who the server would refuse", () => {
    expect(
      verificationAskNames({ colleagues, recordedById: 1, captain })
    ).toEqual(["Juan Cruz"]);
  });

  it("names the Captain when the office has nobody else", () => {
    expect(
      verificationAskNames({ colleagues: [], recordedById: 3, captain })
    ).toEqual(["Rosa Dizon"]);
    expect(
      verificationAskNames({
        colleagues: [person(1, "Maria", "Santos")],
        recordedById: 1,
        captain,
      })
    ).toEqual(["Rosa Dizon"]);
  });

  it("does not name the Captain to the Captain", () => {
    expect(
      verificationAskNames({ colleagues: [], recordedById: 9, captain })
    ).toEqual([]);
  });

  it("has no name to give when the office is empty and there is no Captain", () => {
    expect(
      verificationAskNames({ colleagues: [], recordedById: 3, captain: null })
    ).toEqual([]);
  });
});
