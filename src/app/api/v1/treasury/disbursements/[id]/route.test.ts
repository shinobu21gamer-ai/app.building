import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  transaction: vi.fn(),
  requireApiPermission: vi.fn(),
  permissionForAction: vi.fn(),
  actOnDisbursement: vi.fn(),
  loadVoucherForActor: vi.fn(),
  voucherActionAvailability: vi.fn(),
  allocationBalance: vi.fn(),
  getEffectivePermissions: vi.fn(),
  recordAudit: vi.fn(),
  readCappedFormData: vi.fn(),
  saveConcernImage: vi.fn(),
  deleteConcernImage: vi.fn(),
  imageUrlForFile: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    disbursement: { findUnique: mocks.findUnique },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/auth/session", () => ({
  requireApiPermission: mocks.requireApiPermission,
  getEffectivePermissions: mocks.getEffectivePermissions,
}));
vi.mock("@/lib/audit", () => ({
  recordAudit: mocks.recordAudit,
  requestMeta: () => ({ ip: "127.0.0.1", userAgent: "test" }),
}));
vi.mock("@/lib/treasury/budget", () => ({
  allocationBalance: mocks.allocationBalance,
}));
vi.mock("@/lib/treasury/disbursement", () => ({
  actOnDisbursement: mocks.actOnDisbursement,
  loadVoucherForActor: mocks.loadVoucherForActor,
  permissionForAction: mocks.permissionForAction,
  voucherActionAvailability: mocks.voucherActionAvailability,
}));
vi.mock("@/lib/uploads", () => ({
  readCappedFormData: mocks.readCappedFormData,
  saveConcernImage: mocks.saveConcernImage,
  deleteConcernImage: mocks.deleteConcernImage,
  imageUrlForFile: mocks.imageUrlForFile,
}));

function apiError(status: number, message: string) {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

vi.mock("@/lib/api", () => ({
  withErrorBoundary: (fn: unknown) =>
    async (...args: unknown[]) => {
      try {
        return await (fn as (...a: unknown[]) => unknown)(...args);
      } catch (error) {
        const status = (error as { status?: number }).status ?? 500;
        return Response.json({ error: (error as Error).message }, { status });
      }
    },
  createApiError: {
    notFound: (message: string) => apiError(404, message),
    conflict: (message: string) => apiError(409, message),
    badRequest: (message: string) => apiError(400, message),
    forbidden: (message: string) => apiError(403, message),
  },
  assertSameOrigin: () => undefined,
  parseBody: async (req: Request, schema: { safeParse: (v: unknown) => { success: boolean; data: unknown; error: { issues: { message: string }[] } } }) => {
    const json = await req.json();
    const result = schema.safeParse(json);
    if (!result.success) throw apiError(400, result.error.issues[0]?.message ?? "Invalid body.");
    return result.data;
  },
  ok: (data: unknown) => Response.json(data),
}));

import { PATCH } from "./route";

const ACTOR = { id: 7, role: { key: "TREASURER" }, officeId: null };
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function jsonPatch(id: string, body: unknown) {
  return PATCH(
    new Request(`http://app.test/api/v1/treasury/disbursements/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) }
  );
}

function multipartPatch(id: string, fields: Record<string, string>, file?: File) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  if (file) form.append("proof", file);
  return PATCH(
    new Request(`http://app.test/api/v1/treasury/disbursements/${id}`, { method: "PATCH", body: form }),
    { params: Promise.resolve({ id }) }
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.findUnique.mockResolvedValue({ status: "APPROVED" });
  mocks.permissionForAction.mockReturnValue("treasury.disbursement.prepare");
  mocks.requireApiPermission.mockResolvedValue(ACTOR);
  mocks.actOnDisbursement.mockResolvedValue({ available: 1500 });
  mocks.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn({}));
  mocks.recordAudit.mockResolvedValue(undefined);
  mocks.readCappedFormData.mockImplementation(async (req: Request) => req.formData());
  mocks.saveConcernImage.mockResolvedValue("12345678-1234-4234-8234-123456789abc.png");
  mocks.deleteConcernImage.mockResolvedValue(undefined);
  mocks.imageUrlForFile.mockReturnValue("/api/v1/uploads/12345678-1234-4234-8234-123456789abc.png");
});

describe("voucher action with receipt photo (multipart RELEASE)", () => {
  it("saves the receipt and hands its url to the release", async () => {
    const file = new File([PNG], "receipt.png", { type: "image/png" });
    const res = await multipartPatch("4", { action: "RELEASE", modeOfPayment: "CHECK" }, file);
    expect(res.status).toBe(200);
    expect(mocks.saveConcernImage).toHaveBeenCalledWith(file, 7);
    expect(mocks.actOnDisbursement).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        action: "RELEASE",
        proofUrl: "/api/v1/uploads/12345678-1234-4234-8234-123456789abc.png",
      })
    );
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "TREASURY_DISBURSEMENT_RELEASE", resourceId: "4", userId: 7 })
    );
  });

  it("ignores a file on any action other than RELEASE (no orphaned upload)", async () => {
    const file = new File([PNG], "receipt.png", { type: "image/png" });
    mocks.findUnique.mockResolvedValue({ status: "PREPARED" });
    const res = await multipartPatch("4", { action: "SUBMIT" }, file);
    expect(res.status).toBe(200);
    expect(mocks.saveConcernImage).not.toHaveBeenCalled();
    expect(mocks.actOnDisbursement).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ action: "SUBMIT", proofUrl: null })
    );
  });

  it("still accepts a plain JSON action with no file", async () => {
    const res = await jsonPatch("4", { action: "RELEASE", modeOfPayment: "CHECK" });
    expect(res.status).toBe(200);
    expect(mocks.saveConcernImage).not.toHaveBeenCalled();
    expect(mocks.actOnDisbursement).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ action: "RELEASE", proofUrl: null })
    );
  });

  it("deletes the uploaded receipt when the release itself fails", async () => {
    mocks.actOnDisbursement.mockRejectedValue(apiError(409, "The voucher already left the treasury."));
    const file = new File([PNG], "receipt.png", { type: "image/png" });
    const res = await multipartPatch("4", { action: "RELEASE" }, file);
    expect(res.status).toBe(409);
    expect(mocks.deleteConcernImage).toHaveBeenCalledWith("12345678-1234-4234-8234-123456789abc.png");
  });

  it("rejects an invalid multipart action with a 400", async () => {
    const res = await multipartPatch("4", { action: "EXPLODE" });
    expect(res.status).toBe(400);
    expect(mocks.actOnDisbursement).not.toHaveBeenCalled();
  });

  it("404s for a voucher id that does not exist", async () => {
    const res = await jsonPatch("not-a-number", { action: "RELEASE" });
    expect(res.status).toBe(404);
  });
});
