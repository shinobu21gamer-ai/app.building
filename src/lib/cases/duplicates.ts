import { db } from "@/lib/db";

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function tokens(value: string): Set<string> {
  return new Set(normalize(value).split(" ").filter((token) => token.length > 2));
}

function similarity(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let overlap = 0;
  for (const token of left) if (right.has(token)) overlap += 1;
  return overlap / (left.size + right.size - overlap);
}

/** Finds a strong recent duplicate without blocking submission. */
export async function findLikelyDuplicate(input: {
  userId: number;
  categoryId: number;
  title: string;
  locationAddress: string;
}): Promise<number | null> {
  const candidates = await db.concern.findMany({
    where: {
      userId: input.userId,
      categoryId: input.categoryId,
      createdAt: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
      status: { not: "CLOSED" },
    },
    select: { id: true, title: true, locationAddress: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const title = normalize(input.title);
  const location = normalize(input.locationAddress);
  const titleTokens = tokens(input.title);
  return (
    candidates.find((candidate) => {
      const candidateTitle = normalize(candidate.title);
      const sameTitle = title === candidateTitle;
      const sameLocation = location === normalize(candidate.locationAddress);
      return sameTitle || (sameLocation && similarity(titleTokens, tokens(candidate.title)) >= 0.7);
    })?.id ?? null
  );
}
