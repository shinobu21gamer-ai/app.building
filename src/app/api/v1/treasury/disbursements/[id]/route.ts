import { db } from "@/lib/db";
import {
  assertSameOrigin,
  createApiError,
  ok,
  parseBody,
  withErrorBoundary,
} from "@/lib/api";
import {
  getEffectivePermissions,
  requireApiPermission,
} from "@/lib/auth/session";
import { recordAudit, requestMeta } from "@/lib/audit";
import { disbursementActionSchema } from "@/lib/validations/treasury";
import type { DisbursementAction } from "@/lib/treasury/ledger";
import { allocationBalance } from "@/lib/treasury/budget";
import {
  actOnDisbursement,
  loadVoucherForActor,
  permissionForAction,
  voucherActionAvailability,
} from "@/lib/treasury/disbursement";
import {
  deleteConcernImage,
  imageUrlForFile,
  readCappedFormData,
  saveConcernImage,
} from "@/lib/uploads";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

function voucherIdFrom(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw createApiError.notFound("Voucher not found.");
  }
  return id;
}

function actorFrom(user: { id: number; role: { key: string }; officeId: number | null }) {
  return {
    id: user.id,
    roleKey: user.role.key,
    officeId: user.officeId ?? null,
  };
}

/**
 * GET /api/v1/treasury/disbursements/[id]
 * One voucher with its allocation balance, its approvals and — the part the UI
 * needs — which lifecycle steps the signed-in role may actually take.
 */
export const GET = withErrorBoundary<[Request, RouteContext]>(
  async (_req, ctx) => {
    const user = await requireApiPermission("treasury.balance.view");
    const { id } = await ctx.params;
    const disbursementId = voucherIdFrom(id);
    const actor = actorFrom(user);

    const voucher = await loadVoucherForActor(db, disbursementId, actor);
    const [balance, permissions] = await Promise.all([
      allocationBalance(db, voucher.allocationId),
      getEffectivePermissions(user.role.key),
    ]);

    const approvals = voucher.approvals.map((row) => ({
      level: row.level,
      approverId: row.approverId,
      decision: row.decision,
    }));

    return ok({
      voucher: {
        id: voucher.id,
        voucherNumber: voucher.voucherNumber,
        status: voucher.status,
        amount: Number(voucher.amount),
        payee: voucher.payee,
        payeeType: voucher.payeeType,
        particulars: voucher.particulars,
        modeOfPayment: voucher.modeOfPayment,
        preparedById: voucher.preparedById,
        preparedAt: voucher.preparedAt,
        submittedAt: voucher.submittedAt,
        releasedAt: voucher.releasedAt,
        liquidationDueAt: voucher.liquidationDueAt,
        liquidationStatus: voucher.liquidationStatus,
        liquidationNotes: voucher.liquidationNotes,
        rejectionReason: voucher.rejectionReason,
        cancelReason: voucher.cancelReason,
        proofUrl: voucher.proofUrl,
        allocationId: voucher.allocationId,
        coaCode: voucher.allocation.coaAccount.code,
        coaName: voucher.allocation.coaAccount.name,
        fundSource: voucher.allocation.fundSource.code,
        earmarkId: voucher.earmark?.id ?? null,
        earmarkCode: voucher.earmark?.code ?? null,
        concernId: voucher.concern?.id ?? null,
        caseNumber: voucher.concern?.caseNumber ?? null,
      },
      balance,
      approvals: voucher.approvals.map((row) => ({
        level: row.level,
        decision: row.decision,
        approverRole: row.approverRole,
        remarks: row.remarks,
        decidedAt: row.decidedAt,
      })),
      actionAvailability: voucherActionAvailability({
        status: voucher.status,
        preparedById: voucher.preparedById,
        approvals,
        actor,
        permissions: new Set(permissions),
      }),
    });
  }
);

/**
 * PATCH /api/v1/treasury/disbursements/[id]
 *
 * SUBMIT / RELEASE / LIQUIDATE / CANCEL need `treasury.disbursement.prepare`,
 * CERTIFY needs `treasury.disbursement.certify` (treasurer) and APPROVE needs
 * `treasury.disbursement.approve` (Captain/AAO). The permission is resolved
 * from the action and the voucher's current status, so a role cannot push a
 * voucher past the step that belongs to someone else.
 */
export const PATCH = withErrorBoundary<[Request, RouteContext]>(
  async (req, ctx) => {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    const disbursementId = voucherIdFrom(id);

    // JSON for the usual actions; multipart when a receipt photo travels with
    // the RELEASE — the file goes through the same validated upload pipeline
    // as every other case image.
    const contentType = req.headers.get("content-type") ?? "";
    const isMultipart = contentType.startsWith("multipart/form-data");

    type ActionBody = {
      action: DisbursementAction;
      remarks?: string | null;
      reason?: string | null;
      modeOfPayment?: string | null;
      proofUrl?: string | null;
      liquidationNotes?: string | null;
      liquidationStatus?: string | null;
    };
    let body: ActionBody;
    let receiptFile: File | null = null;
    if (isMultipart) {
      const form = await readCappedFormData(req);
      const file = form.get("proof");
      receiptFile = file instanceof File && file.size > 0 ? file : null;
      const text = (key: string) => {
        const value = form.get(key);
        const textValue = typeof value === "string" ? value.trim() : "";
        return textValue === "" ? null : textValue;
      };
      const raw = {
        action: text("action") ?? "",
        remarks: text("remarks"),
        reason: text("reason"),
        modeOfPayment: text("modeOfPayment") ?? undefined,
        liquidationNotes: text("liquidationNotes"),
        liquidationStatus: text("liquidationStatus") ?? undefined,
      };
      const parsed = disbursementActionSchema.safeParse(raw);
      if (!parsed.success) {
        throw createApiError.badRequest(
          parsed.error.issues[0]?.message ?? "Invalid action."
        );
      }
      body = parsed.data;
    } else {
      body = await parseBody(req, disbursementActionSchema);
    }

    const current = await db.disbursement.findUnique({
      where: { id: disbursementId },
      select: { status: true },
    });
    if (!current) throw createApiError.notFound("Voucher not found.");

    const user = await requireApiPermission(
      permissionForAction(body.action, current.status)
    );
    const actor = actorFrom(user);

    let proofUrl: string | null = body.proofUrl ?? null;
    let uploadedName: string | null = null;
    // Only RELEASE can attach a receipt: that is when the money leaves and
    // the receipt is issued. A file on any other action is ignored rather
    // than saved, so it cannot become an orphaned upload.
    if (receiptFile && body.action === "RELEASE") {
      uploadedName = await saveConcernImage(receiptFile, user.id);
      proofUrl = imageUrlForFile(uploadedName);
    }

    let outcome: Awaited<ReturnType<typeof actOnDisbursement>>;
    try {
      outcome = await db.$transaction((tx) =>
        actOnDisbursement(tx, {
          actor,
          disbursementId,
          action: body.action,
          remarks: body.remarks ?? null,
          reason: body.reason ?? null,
          modeOfPayment: body.modeOfPayment ?? null,
          proofUrl,
          liquidationNotes: body.liquidationNotes ?? null,
          liquidationStatus: body.liquidationStatus ?? null,
        })
      );
    } catch (error) {
      if (uploadedName) await deleteConcernImage(uploadedName);
      throw error;
    }

    const meta = requestMeta(req);
    await recordAudit({
      action: `TREASURY_DISBURSEMENT_${body.action}`,
      resourceType: "disbursement",
      resourceId: String(disbursementId),
      description: [
        `Voucher ${body.action.toLowerCase()}ed`,
        body.remarks ? `— ${body.remarks}` : "",
        body.reason ? `— reason: ${body.reason}` : "",
        outcome.available !== null
          ? `— ₱${outcome.available.toFixed(2)} now available`
          : "",
      ]
        .filter(Boolean)
        .join(" "),
      userId: user.id,
      ...meta,
    });

    return ok(outcome);
  }
);
