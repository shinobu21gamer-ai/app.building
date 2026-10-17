export type PayeeVoucherRow = {
  id: number;
  payee: string;
  payeeType: string;
  payeeUserId: number | null;
  amount: number;
};

export type PayeeVoucherGroup<T extends PayeeVoucherRow> = {
  key: string;
  payee: string;
  payeeType: string;
  vouchers: T[];
  total: number;
};

/**
 * Group only crew vouchers by their stable user id. The voucher records remain
 * separate (and are returned separately inside each group); non-crew vouchers
 * always remain in their own group, even if their display names match.
 */
export function groupVouchersByPayee<T extends PayeeVoucherRow>(
  vouchers: T[],
): PayeeVoucherGroup<T>[] {
  const groups = new Map<string, PayeeVoucherGroup<T>>();
  for (const voucher of vouchers) {
    const key =
      voucher.payeeType === "CREW" && voucher.payeeUserId !== null
        ? `crew:${voucher.payeeUserId}`
        : `voucher:${voucher.id}`;
    const existing = groups.get(key);
    if (existing) {
      existing.vouchers.push(voucher);
      existing.total = Math.round((existing.total + voucher.amount) * 100) / 100;
    } else {
      groups.set(key, {
        key,
        payee: voucher.payee,
        payeeType: voucher.payeeType,
        vouchers: [voucher],
        total: Math.round(voucher.amount * 100) / 100,
      });
    }
  }
  return [...groups.values()];
}
