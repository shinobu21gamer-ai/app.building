import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  concern: vi.fn(), resolution: vi.fn(), history: vi.fn(), fieldCheck: vi.fn(), identity: vi.fn(),
  user: vi.fn(), read: vi.fn(), log: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: {
  concern: { findFirst: mocks.concern }, resolutionRecord: { findFirst: mocks.resolution },
  caseStatusHistory: { findFirst: mocks.history }, fieldCheck: { findFirst: mocks.fieldCheck },
  identityVerification: { findFirst: mocks.identity },
} }));
vi.mock("@/lib/auth/session", () => ({ requireApiUser: mocks.user }));
vi.mock("@/lib/privacy/service", () => ({ logPiiAccess: mocks.log }));
vi.mock("@/lib/api", () => ({
  withErrorBoundary: (fn: unknown) => fn,
  createApiError: {
    notFound: (message: string) => new Error(`404: ${message}`),
    forbidden: (message: string) => new Error(`403: ${message}`),
  },
}));
vi.mock("@/lib/uploads", () => ({
  isSafeImageFilename: (name: string) => name === filename,
  imageMimeForFilename: () => "image/png",
  readConcernImage: mocks.read,
}));
import { GET } from "./route";
const filename = "12345678-1234-1234-1234-123456789abc.png";
const owner = { userId: 1, assignedOfficeId: 4 };
function get() {
  return GET(new Request(`http://app.test/api/v1/uploads/${filename}`), {
    params: Promise.resolve({ filename }),
  });
}
function actor(id: number, key: string, officeId: number | null = null) {
  mocks.user.mockResolvedValue({ id, role: { key }, officeId });
}

beforeEach(() => {
  vi.resetAllMocks();
  for (const mock of [mocks.concern, mocks.resolution, mocks.history, mocks.fieldCheck, mocks.identity]) {
    mock.mockResolvedValue(null);
  }
  mocks.read.mockResolvedValue(Buffer.from([137, 80, 78, 71]));
  actor(1, "RESIDENT");
});

describe("private uploaded photo access", () => {
  it("serves a resident's photo directly with no caching", async () => {
    mocks.concern.mockResolvedValue(owner);
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]));
  });
  it("allows the Captain to see case photos", async () => {
    actor(3, "CAPTAIN"); mocks.concern.mockResolvedValue(owner);
    expect((await get()).status).toBe(200);
  });
  it("does not grant the Captain access to residents' ID photos", async () => {
    actor(3, "CAPTAIN"); mocks.identity.mockResolvedValue({ userId: 1 });
    await expect(get()).rejects.toThrow("403");
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("allows an assigned-office official but denies another office", async () => {
    mocks.history.mockResolvedValue({ concern: owner });
    actor(2, "OFFICIAL", 4); expect((await get()).status).toBe(200);
    actor(2, "OFFICIAL", 5); await expect(get()).rejects.toThrow("403");
  });
  it("resolves a field-check photo and allows its assigned checker", async () => {
    actor(8, "CREW"); mocks.fieldCheck.mockResolvedValue({ concern: owner, assigneeId: 8 });
    expect((await get()).status).toBe(200);
    expect(mocks.fieldCheck).toHaveBeenCalledWith(expect.objectContaining({
      where: { findingPhotoUrl: `/api/v1/uploads/${filename}` },
    }));
  });
  it("denies an unrelated crew member access to a field-check photo", async () => {
    actor(9, "CREW"); mocks.fieldCheck.mockResolvedValue({ concern: owner, assigneeId: 8 });
    await expect(get()).rejects.toThrow("403");
  });
  it("lets the resident see their case's field-check proof", async () => {
    mocks.fieldCheck.mockResolvedValue({ concern: owner, assigneeId: 8 });
    expect((await get()).status).toBe(200);
  });
  it("logs administrator access to identity documents", async () => {
    actor(2, "ADMIN"); mocks.identity.mockResolvedValue({ userId: 1 });
    expect((await get()).status).toBe(200);
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({ actorId: 2, subjectUserId: 1, field: "identity_document" }));
  });
  it("does not serve unreferenced uploads", async () => {
    await expect(get()).rejects.toThrow("404");
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("returns not found for lost image bytes", async () => {
    mocks.concern.mockResolvedValue(owner); mocks.read.mockResolvedValue(null);
    await expect(get()).rejects.toThrow("404");
  });
  it("rejects unsafe filenames before querying ownership or reading bytes", async () => {
    await expect(GET(new Request("http://app.test"), {
      params: Promise.resolve({ filename: "../private.png" }),
    })).rejects.toThrow("404");
    expect(mocks.concern).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });
});
