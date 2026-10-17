import { describe, expect, it } from "vitest";
import {
  BENEFIT_CONCERN_TYPES,
  IDENTITY_STATUSES,
  ID_METHODS,
  applyIdentityExpiry,
  effectiveIdentityStatus,
  identityGateDecision,
  identityMethodLabel,
  identityStatusLabel,
  isIdentityMethod,
  isIdentityStatus,
  needsVerifiedIdentity,
} from "./policy";

describe("identity catalogue", () => {
  it("uses known statuses and methods only", () => {
    expect(isIdentityStatus("VERIFIED")).toBe(true);
    expect(isIdentityStatus("MAYBE")).toBe(false);
    expect(isIdentityMethod("PHILSYS")).toBe(true);
    expect(isIdentityMethod("SELFIE")).toBe(false);
    expect(IDENTITY_STATUSES).toContain("PENDING");
    expect(ID_METHODS).toContain("BARANGAY_ID");
  });

  it("labels statuses and methods, and passes unknown values through", () => {
    expect(identityStatusLabel("PENDING")).toBe("Waiting for review");
    expect(identityStatusLabel("WEIRD")).toBe("WEIRD");
    expect(identityMethodLabel("UMID")).toBe("UMID");
    expect(identityMethodLabel(null)).toBeNull();
    expect(identityMethodLabel("HANDWRITTEN")).toBe("HANDWRITTEN");
  });
});

describe("applyIdentityExpiry", () => {
  const now = new Date("2026-10-12T00:00:00Z");

  it("keeps a current verification valid", () => {
    expect(
      applyIdentityExpiry({ status: "VERIFIED", expiresAt: null }, now)
    ).toBe("VERIFIED");
    expect(
      applyIdentityExpiry(
        { status: "VERIFIED", expiresAt: new Date("2027-01-01T00:00:00Z") },
        now
      )
    ).toBe("VERIFIED");
  });

  it("lapses a verification whose expiry has passed", () => {
    expect(
      applyIdentityExpiry(
        { status: "VERIFIED", expiresAt: new Date("2026-01-01T00:00:00Z") },
        now
      )
    ).toBe("EXPIRED");
  });

  it("passes through the other statuses and defaults unknown ones", () => {
    expect(applyIdentityExpiry({ status: "PENDING" }, now)).toBe("PENDING");
    expect(applyIdentityExpiry({ status: "REJECTED" }, now)).toBe("REJECTED");
    expect(applyIdentityExpiry({ status: "NONSENSE" }, now)).toBe("UNVERIFIED");
  });
});

describe("effectiveIdentityStatus", () => {
  const now = new Date("2026-10-12T00:00:00Z");

  it("does not treat a VERIFIED flag without a recorded admin review as verified", () => {
    expect(
      effectiveIdentityStatus(
        { status: "VERIFIED", submittedAt: new Date("2026-10-10T00:00:00Z") },
        now
      )
    ).toBe("PENDING");
    expect(
      effectiveIdentityStatus({ status: "VERIFIED", submittedAt: null }, now)
    ).toBe("UNVERIFIED");
  });

  it("requires reviewer, review time, and verified time for approval", () => {
    expect(
      effectiveIdentityStatus(
        {
          status: "VERIFIED",
          submittedAt: new Date("2026-10-10T00:00:00Z"),
          reviewedById: 7,
          reviewedAt: new Date("2026-10-11T00:00:00Z"),
          verifiedAt: new Date("2026-10-11T00:00:00Z"),
        },
        now
      )
    ).toBe("VERIFIED");
  });
});

describe("needsVerifiedIdentity", () => {
  it("gates exactly the benefit-bearing types", () => {
    for (const type of BENEFIT_CONCERN_TYPES) {
      expect(needsVerifiedIdentity(type)).toBe(true);
      expect(needsVerifiedIdentity(type.toLowerCase())).toBe(true);
    }
    expect(needsVerifiedIdentity("REPAIR")).toBe(false);
    expect(needsVerifiedIdentity("DOCUMENTS")).toBe(false);
    expect(needsVerifiedIdentity(null)).toBe(false);
  });
});

describe("identityGateDecision", () => {
  it("blocks an unverified resident on an assistance concern", () => {
    const decision = identityGateDecision({
      concernTypeKey: "AYUDA",
      status: "UNVERIFIED",
      gateEnabled: true,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.required).toBe(true);
    expect(decision.code).toBe("IDENTITY_REQUIRED");
    expect(decision.message).toContain("Verify your identity");
  });

  it("explains separately that a submission is still pending or rejected", () => {
    expect(
      identityGateDecision({
        concernTypeKey: "BUDGET",
        status: "PENDING",
        gateEnabled: true,
      }).code
    ).toBe("IDENTITY_PENDING");
    expect(
      identityGateDecision({
        concernTypeKey: "BUDGET",
        status: "REJECTED",
        gateEnabled: true,
      }).code
    ).toBe("IDENTITY_REJECTED");
  });

  it("lets a verified resident through", () => {
    const decision = identityGateDecision({
      concernTypeKey: "AYUDA",
      status: "VERIFIED",
      gateEnabled: true,
    });
    expect(decision.allowed).toBe(true);
    expect(decision.satisfied).toBe(true);
    expect(decision.code).toBeNull();
  });

  it("is advisory, never blocking, for repair and document concerns", () => {
    const decision = identityGateDecision({
      concernTypeKey: "REPAIR",
      status: "UNVERIFIED",
      gateEnabled: true,
    });
    expect(decision.allowed).toBe(true);
    expect(decision.required).toBe(false);
    expect(decision.advisory).toBe(true);
    expect(decision.message).toContain("optional");
  });

  it("never blocks when the administrator switched the gate off", () => {
    for (const status of IDENTITY_STATUSES) {
      const decision = identityGateDecision({
        concernTypeKey: "AYUDA",
        status,
        gateEnabled: false,
      });
      expect(decision.allowed).toBe(true);
      expect(decision.required).toBe(false);
    }
  });
});
