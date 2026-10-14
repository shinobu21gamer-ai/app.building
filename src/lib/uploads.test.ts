import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const mocks = vi.hoisted(() => ({ create: vi.fn(), aggregate: vi.fn(), find: vi.fn(), quota: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { uploadRecord: {
  create: mocks.create, aggregate: mocks.aggregate, findUnique: mocks.find,
} } }));
vi.mock("@/lib/cases/settings", () => ({ getUploadDailyQuotaBytes: mocks.quota }));
vi.mock("@/lib/api", () => ({ createApiError: {
  badRequest: (message: string) => new Error(message),
  payloadTooLarge: (message: string) => new Error(message),
} }));
import { readConcernImage, saveConcernImage, usingDatabaseUploads } from "./uploads";
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const filename = "12345678-1234-1234-1234-123456789abc.png";
let directory: string;

beforeEach(async () => {
  vi.resetAllMocks();
  vi.stubEnv("UPLOAD_STORAGE", "");
  directory = await mkdtemp(path.join(os.tmpdir(), "upload-test-"));
  vi.stubEnv("UPLOAD_DIR", directory);
  mocks.quota.mockResolvedValue(25 * 1024 * 1024);
  mocks.aggregate.mockResolvedValue({ _sum: { bytes: 0 } });
  mocks.find.mockResolvedValue(null);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

describe("durable photo storage", () => {
  it("defaults to database storage even outside Vercel", () => {
    vi.stubEnv("VERCEL", "");
    expect(usingDatabaseUploads()).toBe(true);
  });
  it.each(["disk", "filesystem"])("allows explicit persistent %s storage", (storage) => {
    vi.stubEnv("UPLOAD_STORAGE", storage);
    expect(usingDatabaseUploads()).toBe(false);
  });
  it("stores new photo bytes in the database by default", async () => {
    const saved = await saveConcernImage(new File([png], "proof.png", { type: "image/png" }), 1);
    expect(mocks.create).toHaveBeenCalledWith({ data: { userId: 1, filename: saved, bytes: png.length, data: png } });
  });
  it("still writes to disk when explicitly configured", async () => {
    vi.stubEnv("UPLOAD_STORAGE", "disk");
    const saved = await saveConcernImage(new File([png], "proof.png", { type: "image/png" }), 1);
    expect(await readFile(path.join(directory, saved))).toEqual(png);
    expect(mocks.create).toHaveBeenCalledWith({ data: { userId: 1, filename: saved, bytes: png.length } });
  });
  it("reads database bytes independent of the current storage setting", async () => {
    vi.stubEnv("UPLOAD_STORAGE", "disk");
    mocks.find.mockResolvedValue({ data: new Uint8Array(png) });
    expect(await readConcernImage(filename)).toEqual(png);
  });
  it("reads existing disk images even after switching to database storage", async () => {
    await writeFile(path.join(directory, filename), png);
    expect(await readConcernImage(filename)).toEqual(png);
  });
  it("reports missing legacy files as unavailable", async () => {
    expect(await readConcernImage(filename)).toBeNull();
  });
  it("still enforces upload quota before storing bytes", async () => {
    mocks.quota.mockResolvedValue(1);
    await expect(saveConcernImage(new File([png], "proof.png", { type: "image/png" }), 1)).rejects.toThrow("daily image upload limit");
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
