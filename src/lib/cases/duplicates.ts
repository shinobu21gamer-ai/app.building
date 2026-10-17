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

type DuplicateCandidate = {
  id: number;
  userId: number;
  caseNumber: string;
  status: string;
  title: string;
  locationAddress: string;
};

export type LikelyDuplicate =
  | {
      id: number;
      sameResident: true;
      caseNumber: string;
      title: string;
      status: string;
    }
  | { id: number; sameResident: false };

export type DuplicateSubmissionDecision =
  | { kind: "REVIEW"; match: LikelyDuplicate }
  | { kind: "CREATE"; duplicateOfId: null };

/** A possible match blocks silently filing; explicit confirmation means a separate case. */
export function decideDuplicateSubmission(
  match: LikelyDuplicate | null,
  allowSeparateIssue: boolean
): DuplicateSubmissionDecision {
  return match && !allowSeparateIssue
    ? { kind: "REVIEW", match }
    : { kind: "CREATE", duplicateOfId: null };
}

/** Finds a strong recent match while exposing case details only to its owner. */
export async function findLikelyDuplicate(input: {
  userId: number;
  categoryId: number;
  title: string;
  locationAddress: string;
}): Promise<LikelyDuplicate | null> {
  const candidates = (await db.concern.findMany({
    where: {
      categoryId: input.categoryId,
      createdAt: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
      status: { notIn: ["CLOSED", "RESOLVED"] },
    },
    select: {
      id: true,
      userId: true,
      caseNumber: true,
      status: true,
      title: true,
      locationAddress: true,
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  })) as DuplicateCandidate[];

  const title = normalize(input.title);
  const location = normalize(input.locationAddress);
  const titleTokens = tokens(input.title);
  const matches = candidates.filter((candidate) => {
    const candidateTitle = normalize(candidate.title);
    const sameTitle = title === candidateTitle;
    const sameLocation = location === normalize(candidate.locationAddress);
    return sameLocation && (sameTitle || similarity(titleTokens, tokens(candidate.title)) >= 0.7);
  });
  const match =
    matches.find((candidate) => candidate.userId === input.userId) ?? matches[0];

  if (!match) return null;
  if (match.userId !== input.userId) return { id: match.id, sameResident: false };
  return {
    id: match.id,
    sameResident: true,
    caseNumber: match.caseNumber,
    title: match.title,
    status: match.status,
  };
}
