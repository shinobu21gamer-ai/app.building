import type { Prisma } from "@prisma/client";
import { createApiError } from "@/lib/api";
import { notifyResidentReplyReceived } from "@/lib/notifications/service";
import { canReplyToFieldCheck } from "@/lib/cases/field-check-rules";

type Tx = Prisma.TransactionClient;

export type ResidentFieldCheckReplyInput = {
  concernId: number;
  fieldCheckId: number;
  message: string;
  actor: { id: number };
};

/** Adds a resident-authored, resident-visible message to an open field check. */
export async function replyToFieldCheck(
  tx: Tx,
  input: ResidentFieldCheckReplyInput
): Promise<{ replyId: number; caseNumber: string }> {
  const check = await tx.fieldCheck.findFirst({
    where: { id: input.fieldCheckId, concernId: input.concernId },
    select: {
      id: true,
      status: true,
      concern: {
        select: {
          id: true,
          caseNumber: true,
          userId: true,
          assignedOfficeId: true,
          assignedOfficialId: true,
        },
      },
    },
  });

  // Return the same not-found response for another resident's case and an
  // invalid check id so the route cannot be used to discover either record.
  if (!check || check.concern.userId !== input.actor.id) {
    throw createApiError.notFound("Concern not found.");
  }
  if (!canReplyToFieldCheck(check.status)) {
    throw createApiError.conflict(
      "This field check is no longer open for a resident reply."
    );
  }

  const message = input.message.trim();
  if (message.length < 1 || message.length > 1000) {
    throw createApiError.badRequest("Write a reply of up to 1,000 characters.");
  }

  const reply = await tx.caseStatusHistory.create({
    data: {
      concernId: input.concernId,
      entryType: "RESIDENT_REPLY",
      remarks: message,
      visibility: "RESIDENT_VISIBLE",
      metadataJson: JSON.stringify({ fieldCheckId: check.id }),
      actorId: input.actor.id,
      actorRole: "RESIDENT",
    },
    select: { id: true },
  });

  await notifyResidentReplyReceived(tx, {
    concernId: check.concern.id,
    caseNumber: check.concern.caseNumber,
    officeId: check.concern.assignedOfficeId,
    officialId: check.concern.assignedOfficialId,
  });

  return { replyId: reply.id, caseNumber: check.concern.caseNumber };
}
