import { describe, expect, it } from "vitest";
import { notificationHref } from "./href";

describe("notificationHref", () => {
  it("opens the resident case sheet when they have a numbered concern", () => {
    expect(
      notificationHref({ type: "CONCERN_SUBMITTED", role: "RESIDENT", concernId: 12 }),
    ).toBe("/resident/concerns/12");
  });

  it("opens the official case sheet for desk staff", () => {
    expect(
      notificationHref({ type: "CONCERN_ASSIGNED", role: "OFFICIAL", concernId: 9 }),
    ).toBe("/official/concerns/9");
  });

  it("sends crew to their board (they have no case sheet)", () => {
    expect(
      notificationHref({ type: "FIELD_CHECK_ASSIGNED", role: "CREW", concernId: 4 }),
    ).toBe("/crew");
    expect(
      notificationHref({ type: "CONCERN_ASSIGNED", role: "CREW", concernId: 4 }),
    ).toBe("/crew");
  });

  it("sends admin to the case they must type-check, or the validation queue", () => {
    expect(
      notificationHref({ type: "CONCERN_SUBMITTED", role: "ADMIN", concernId: 3 }),
    ).toBe("/official/concerns/3");
    expect(
      notificationHref({ type: "CONCERN_SUBMITTED", role: "ADMIN", concernId: null }),
    ).toBe("/admin/validation");
  });

  it("opens privacy requests when consent is required (no case)", () => {
    expect(
      notificationHref({ type: "CONSENT_REQUIRED", role: "RESIDENT", concernId: null }),
    ).toBe("/privacy/requests");
  });

  it("opens the case (or captain queue) when an earmark waits for the captain", () => {
    expect(
      notificationHref({ type: "EARMARK_PROPOSED", role: "CAPTAIN", concernId: 8 }),
    ).toBe("/official/concerns/8");
    expect(
      notificationHref({ type: "EARMARK_PROPOSED", role: "CAPTAIN", concernId: null }),
    ).toBe("/captain/approvals");
  });

  it("opens the prefilled crew-payment voucher for the treasurer when a case is resolved", () => {
    expect(
      notificationHref({ type: "CREW_PAYMENT_READY", role: "TREASURER", concernId: 18 }),
    ).toBe("/treasury/disbursements?concernId=18&pay=CREW");
    expect(
      notificationHref({ type: "CREW_PAYMENT_READY", role: "TREASURER", concernId: null }),
    ).toBe("/treasury/disbursements");
  });

  it("opens the fund desk for the treasurer on earmark notes", () => {
    expect(
      notificationHref({ type: "EARMARK_PROPOSED", role: "TREASURER", concernId: 8 }),
    ).toBe("/treasury/fund?concernId=8");
    expect(
      notificationHref({ type: "EARMARK_APPROVED", role: "TREASURER", concernId: 8 }),
    ).toBe("/treasury/fund?concernId=8");
  });

  it("opens the case on SLA breach, or the captain home when there is no case", () => {
    expect(
      notificationHref({ type: "SLA_BREACHED", role: "OFFICIAL", concernId: 2 }),
    ).toBe("/official/concerns/2");
    expect(
      notificationHref({ type: "SLA_BREACHED", role: "CAPTAIN", concernId: null }),
    ).toBe("/captain");
  });

  it("returns null when there is nowhere to go", () => {
    expect(
      notificationHref({ type: "CONCERN_RESOLVED", role: "OFFICIAL", concernId: null }),
    ).toBeNull();
  });
});
