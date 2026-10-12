import { describe, expect, it } from "vitest";
import { seesWholeBudget } from "@/lib/treasury/budget";
import {
  permissionForAction,
  voucherActionAvailability,
  voucherIsPaid,
} from "@/lib/treasury/disbursement";
import type { Actor } from "@/lib/treasury/budget";

const admin: Actor = { id: 1, roleKey: "ADMIN", officeId: null };
const treasurer: Actor = { id: 10, roleKey: "TREASURER", officeId: null };
const captain: Actor = { id: 20, roleKey: "CAPTAIN", officeId: null };
const official: Actor = { id: 30, roleKey: "OFFICIAL", officeId: 3 };
const resident: Actor = { id: 40, roleKey: "RESIDENT", officeId: null };
const crew: Actor = { id: 50, roleKey: "CREW", officeId: null };

const everyTreasuryPermission = new Set([
  "treasury.disbursement.prepare",
  "treasury.disbursement.certify",
  "treasury.disbursement.approve",
  "treasury.balance.view",
]);

describe("who sees the whole budget", () => {
  it("covers the treasurer, the Captain (AAO) and the administrator", () => {
    expect(seesWholeBudget(treasurer)).toBe(true);
    expect(seesWholeBudget(captain)).toBe(true);
    expect(seesWholeBudget(admin)).toBe(true);
  });

  it("keeps officials to their own office, and everyone else out", () => {
    expect(seesWholeBudget(official)).toBe(false);
    expect(seesWholeBudget(resident)).toBe(false);
    expect(seesWholeBudget(crew)).toBe(false);
  });
});

describe("permissionForAction", () => {
  it("needs a certification permission for CERTIFY", () => {
    expect(permissionForAction("CERTIFY", "SUBMITTED")).toBe(
      "treasury.disbursement.certify"
    );
  });

  it("needs the approval permission for APPROVE", () => {
    expect(permissionForAction("APPROVE", "CERTIFIED")).toBe(
      "treasury.disbursement.approve"
    );
  });

  it("routes REJECT to whoever currently holds the voucher", () => {
    expect(permissionForAction("REJECT", "SUBMITTED")).toBe(
      "treasury.disbursement.certify"
    );
    expect(permissionForAction("REJECT", "CERTIFIED")).toBe(
      "treasury.disbursement.approve"
    );
  });

  it("keeps preparation-side steps on the prepare permission", () => {
    expect(permissionForAction("SUBMIT", "DRAFT")).toBe(
      "treasury.disbursement.prepare"
    );
    expect(permissionForAction("RELEASE", "APPROVED")).toBe(
      "treasury.disbursement.prepare"
    );
    expect(permissionForAction("LIQUIDATE", "RELEASED")).toBe(
      "treasury.disbursement.prepare"
    );
    expect(permissionForAction("CANCEL", "SUBMITTED")).toBe(
      "treasury.disbursement.prepare"
    );
  });
});

describe("voucher action availability", () => {
  it("lets the treasurer submit a draft they prepared", () => {
    const actions = voucherActionAvailability({
      status: "DRAFT",
      preparedById: treasurer.id,
      approvals: [],
      actor: treasurer,
      permissions: everyTreasuryPermission,
    });

    expect(actions).toEqual([
      { action: "SUBMIT", allowed: true, reason: null },
      {
        action: "CANCEL",
        allowed: true,
        reason: null,
      },
    ]);
  });

  it("refuses the treasurer their own certification (separation of duties)", () => {
    const actions = voucherActionAvailability({
      status: "SUBMITTED",
      preparedById: treasurer.id,
      approvals: [],
      actor: treasurer,
      permissions: everyTreasuryPermission,
    });

    const certify = actions.find((entry) => entry.action === "CERTIFY");
    expect(certify?.allowed).toBe(false);
    expect(certify?.reason).toBeTruthy();
  });

  it("lets another treasurer certify, but not approve before certifying", () => {
    const actions = voucherActionAvailability({
      status: "SUBMITTED",
      preparedById: 99,
      approvals: [],
      actor: treasurer,
      permissions: everyTreasuryPermission,
    });

    const byAction = new Map(actions.map((entry) => [entry.action, entry]));
    expect(byAction.get("CERTIFY")?.allowed).toBe(true);
    // Approval is not even offered while the voucher is still SUBMITTED —
    // the treasurer has to certify the funds first.
    expect(byAction.has("APPROVE")).toBe(false);
    expect([...byAction.keys()]).toEqual(["CERTIFY", "REJECT", "CANCEL"]);
  });

  it("only offers the AAO approval once level 1 is certified, and blocks a repeat approver", () => {
    const approvedByCaptain = voucherActionAvailability({
      status: "CERTIFIED",
      preparedById: 99,
      approvals: [
        { level: 1, approverId: treasurer.id, decision: "CERTIFIED" },
      ],
      actor: captain,
      permissions: everyTreasuryPermission,
    });
    const byAction = new Map(
      approvedByCaptain.map((entry) => [entry.action, entry])
    );
    expect(byAction.get("APPROVE")?.allowed).toBe(true);

    const samePerson = voucherActionAvailability({
      status: "CERTIFIED",
      preparedById: 99,
      approvals: [
        { level: 1, approverId: captain.id, decision: "CERTIFIED" },
      ],
      actor: captain,
      permissions: everyTreasuryPermission,
    });
    const blocked = samePerson.find((entry) => entry.action === "APPROVE");
    expect(blocked?.allowed).toBe(false);
    expect(blocked?.reason).toBeTruthy();
  });

  it("hides steps the role cannot hold", () => {
    const actions = voucherActionAvailability({
      status: "APPROVED",
      preparedById: 99,
      approvals: [],
      actor: captain,
      permissions: new Set(["treasury.disbursement.approve"]),
    });

    expect(actions).toEqual([
      {
        action: "RELEASE",
        allowed: false,
        reason: "Your role does not hold the permission for this step.",
      },
      {
        action: "CANCEL",
        allowed: false,
        reason: "Your role does not hold the permission for this step.",
      },
    ]);
  });

  it("offers nothing on a voucher that is already liquidated", () => {
    expect(
      voucherActionAvailability({
        status: "LIQUIDATED",
        preparedById: 99,
        approvals: [],
        actor: treasurer,
        permissions: everyTreasuryPermission,
      })
    ).toEqual([]);
  });
});

describe("voucherIsPaid", () => {
  it("counts released and liquidated vouchers as money out of the door", () => {
    expect(voucherIsPaid("RELEASED")).toBe(true);
    expect(voucherIsPaid("LIQUIDATED")).toBe(true);
    expect(voucherIsPaid("APPROVED")).toBe(false);
    expect(voucherIsPaid("DRAFT")).toBe(false);
  });
});
