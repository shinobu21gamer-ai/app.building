import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

const MANILA_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Manila",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Builds the next case number for the current day in the form
 * BR-YYYYMMDD-NNNN. Must run inside the same transaction that creates the
 * concern and the caller retries on a unique-constraint conflict, so
 * concurrent submissions cannot both grab the same sequence value.
 *
 * Sequence is derived from a COUNT rather than lexicographic max: string
 * ordering of padded numbers breaks at 10000/day ("10000" sorts before
 * "0002"), while counting keeps working at any volume.
 */
export async function generateCaseNumber(tx: Tx): Promise<string> {
  const datePart = MANILA_DATE.format(new Date()).replace(/-/g, "");
  const prefix = `BR-${datePart}-`;

  const todayCount = await tx.concern.count({
    where: { caseNumber: { startsWith: prefix } },
  });

  const nextSequence = todayCount + 1;
  return `${prefix}${String(nextSequence).padStart(4, "0")}`;
}
