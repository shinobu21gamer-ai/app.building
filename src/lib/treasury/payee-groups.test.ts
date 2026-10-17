import { describe, expect, it } from "vitest";
import { groupVouchersByPayee } from "./payee-groups";

const voucher = (
  id: number,
  payee: string,
  payeeType: string,
  payeeUserId: number | null,
  amount: number,
) => ({ id, payee, payeeType, payeeUserId, amount });

describe("groupVouchersByPayee", () => {
  it("groups separate crew vouchers by stable payee id without combining their records", () => {
    const groups = groupVouchersByPayee([
      voucher(1, "Ava Reyes", "CREW", 11, 450),
      voucher(2, "Ava Reyes", "CREW", 11, 275.5),
      voucher(3, "Ben Cruz", "CREW", 12, 300),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      key: "crew:11",
      payee: "Ava Reyes",
      total: 725.5,
      vouchers: [{ id: 1 }, { id: 2 }],
    });
    expect(groups[1].vouchers.map(({ id }) => id)).toEqual([3]);
  });

  it("does not group suppliers or crew rows without a user id by matching display names", () => {
    const groups = groupVouchersByPayee([
      voucher(1, "Same Name", "SUPPLIER", null, 20),
      voucher(2, "Same Name", "SUPPLIER", null, 30),
      voucher(3, "Crew Name", "CREW", null, 40),
      voucher(4, "Crew Name", "CREW", null, 50),
    ]);
    expect(groups.map((group) => group.vouchers.map(({ id }) => id))).toEqual([
      [1], [2], [3], [4],
    ]);
  });
});
