import { Prisma } from "@prisma/client";
import { createApiError } from "@/lib/api";
import {
  canSubmitFeedback,
  satisfactionForRating,
} from "@/lib/cases/workflow";
import { isFeedbackResubmissionAllowed } from "@/lib/cases/settings";

type Tx = Prisma.TransactionClient;

export type FeedbackInput = {
  concernId: number;
  actor: { id: number };
  wasResolved: boolean;
  rating: number;
  comment?: string | null;
};

export type FeedbackOutcome = {
  concernId: number;
  caseNumber: string;
  created: boolean;
  rating: number;
};

async function loadConcernForFeedback(tx: Tx, concernId: number, actorId: number) {
  const concern = await tx.concern.findUnique({
    where: { id: concernId },
    select: {
      id: true,
      caseNumber: true,
      userId: true,
      status: true,
      feedback: { take: 1 },
    },
  });
  // A resident may only ever see and rate their own cases; returning 404 (not
  // 403) for someone else's case avoids leaking that the case exists.
  if (!concern || concern.userId !== actorId) {
    throw createApiError.notFound("Concern not found.");
  }
  return concern;
}

/**
 * Records a resident's feedback for a resolved/closed case. One row per case
 * (enforced by the unique concernId). By default a resident may submit once;
 * when the administrator enables feedback re-submission, a later submission
 * updates the same row in place so the case always keeps exactly one
 * feedback record.
 */
export async function submitFeedback(
  tx: Tx,
  input: FeedbackInput
): Promise<FeedbackOutcome> {
  const concern = await loadConcernForFeedback(
    tx,
    input.concernId,
    input.actor.id
  );

  if (!canSubmitFeedback(concern.status)) {
    throw createApiError.badRequest(
      "Feedback is available once the case has been resolved."
    );
  }

  const resubmissionAllowed = await isFeedbackResubmissionAllowed(tx);
  const existing = concern.feedback[0] ?? null;
  if (existing && !resubmissionAllowed) {
    throw createApiError.conflict(
      "You have already submitted feedback for this case."
    );
  }

  const satisfaction = satisfactionForRating(input.rating);
  const comment =
    input.comment && input.comment.trim() !== "" ? input.comment.trim() : null;

  if (existing) {
    await tx.feedback.update({
      where: { id: existing.id },
      data: {
        rating: input.rating,
        satisfaction,
        wasResolved: input.wasResolved,
        comment,
      },
    });
    return {
      concernId: concern.id,
      caseNumber: concern.caseNumber,
      created: false,
      rating: input.rating,
    };
  }

  await tx.feedback.create({
    data: {
      concernId: concern.id,
      userId: concern.userId,
      rating: input.rating,
      satisfaction,
      wasResolved: input.wasResolved,
      comment,
    },
  });
  return {
    concernId: concern.id,
    caseNumber: concern.caseNumber,
    created: true,
    rating: input.rating,
  };
}