import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
  requireApiPermission: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    concern: { findUnique: mocks.findUnique },
    budgetDecision: { upsert: mocks.upsert },
  },
}));
vi.mock("@/lib/auth/session", () => ({
  requireApiPermission: mocks.requireApiPermission,
}));
vi.mock("@/lib/audit", () => ({
  recordAudit: mocks.recordAudit,
  requestMeta: () => ({ ip: "127.0.0.1", userAgent: "test" }),
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
  parseBody: async (req: Request, schema: { safeParse: (v: unknown) => { success: boolean; data: unknown; error: ZodError } }) => {
    const json = await req.json();
    const result = schema.safeParse(json);
    if (!result.success) throw apiError(400, result.error.issues[0]?.message ?? "Invalid body.");
    return result.data;
  },
  ok: (data: unknown) => Response.json(data),
}));

import { POST } from "./route";

const TREASURER = { id: 7, role: { key: "TREASURER" }, officeId: null };

function post(id: string, body: unknown) {
  return POST(
    new Request(`http://app.test/api/v1/treasury/concerns/${id}/budget-decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) }
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.findUnique.mockResolvedValue(null);
  mocks.upsert.mockResolvedValue({});
  mocks.recordAudit.mockResolvedValue(undefined);
  mocks.requireApiPermission.mockResolvedValue(TREASURER);
});

describe("treasury budget decision (do not fund)", () => {
  it("requires the earmark prepare permission", async () => {
    mocks.requireApiPermission.mockRejectedValue(apiError(403, "You do not have that right."));
    const res = await post("1", { reason: "No budget is left for this year." });
    expect(res.status).toBe(403);
  });

  it("404s when the concern id is not a real id", async () => {
    const res = await post("abc", { reason: "No budget is left for this year." });
    expect(res.status).toBe(404);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("404s when the concern does not exist", async () => {
    mocks.findUnique.mockResolvedValue(null);
    const res = await post("9", { reason: "No budget is left for this year." });
    expect(res.status).toBe(404);
  });

  it("rejects a finished case", async () => {
    mocks.findUnique.mockResolvedValue({ id: 9, caseNumber: "BR-2026-009", status: "RESOLVED" });
    const res = await post("9", { reason: "No budget is left for this year." });
    expect(res.status).toBe(409);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("requires a real reason (at least 10 characters)", async () => {
    mocks.findUnique.mockResolvedValue({ id: 9, caseNumber: "BR-2026-009", status: "AWAITING_BUDGET" });
    const res = await post("9", { reason: "too short" });
    expect(res.status).toBe(400);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("records the first decision as a NOT_FUNDED row for the case", async () => {
    mocks.findUnique.mockResolvedValue({ id: 9, caseNumber: "BR-2026-009", status: "AWAITING_BUDGET" });
    const res = await post("9", { reason: "The allocation for this office is already spent." });
    expect(res.status).toBe(200);
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { concernId: 9 },
        create: expect.objectContaining({
          concernId: 9,
          decision: "NOT_FUNDED",
          reason: "The allocation for this office is already spent.",
          decidedById: 7,
        }),
        update: expect.objectContaining({
          decision: "NOT_FUNDED",
          reason: "The allocation for this office is already spent.",
          decidedById: 7,
        }),
      })
    );
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "BUDGET_DECISION",
        resourceType: "concern",
        resourceId: "9",
        userId: 7,
      })
    );
    expect(await res.json()).toEqual({ concernId: 9, decision: "NOT_FUNDED" });
  });

  it("stamps a fresh decidedAt when the decision is replaced", async () => {
    mocks.findUnique.mockResolvedValue({ id: 9, caseNumber: "BR-2026-009", status: "AWAITING_BUDGET" });
    await post("9", { reason: "Second call: the works may wait for next year." });
    const call = mocks.upsert.mock.calls[0][0] as { update: { decidedAt: Date } };
    expect(call.update.decidedAt).toBeInstanceOf(Date);
  });
});
