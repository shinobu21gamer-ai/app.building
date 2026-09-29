import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { getUploadDailyQuotaBytes } from "@/lib/cases/settings";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_MB = 5;

// Cap the whole multipart request (field overhead + one 5 MB file) before any
// buffering so a client can never force the server to hold an unbounded body.
export const MAX_UPLOAD_REQUEST_BYTES = MAX_IMAGE_BYTES + 512 * 1024;

const MIME_EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

// Random UUID basename + canonical extension. Anything else is rejected, so a
// caller can never traverse the filesystem or request an arbitrary file.
const SAFE_FILENAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

export function getUploadDir(): string {
  return process.env.UPLOAD_DIR
    ? path.resolve(process.env.UPLOAD_DIR)
    : path.join(process.cwd(), "uploads");
}

/**
 * Where image bytes actually live.
 *
 * Serverless hosts (Vercel) mount a read-only filesystem, so writing to
 * `uploads/` fails outright. There the bytes are stored in Postgres instead.
 * `UPLOAD_STORAGE` can force either mode; otherwise disk is used except on
 * Vercel.
 */
export function usingDatabaseUploads(): boolean {
  const configured = process.env.UPLOAD_STORAGE?.toLowerCase();
  if (configured === "database" || configured === "db") return true;
  if (configured === "disk" || configured === "filesystem") return false;
  return Boolean(process.env.VERCEL);
}

/**
 * Detects the real image type from the file's magic bytes. Trusting the
 * client-supplied MIME type alone would let an executable (or any file) be
 * renamed to `.jpg` and accepted.
 */
function sniffImageMime(buffer: Buffer): string | null {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "image/jpeg";
  }

  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }

  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }

  return null;
}

/**
 * Reads a multipart request body enforcing a hard byte cap BEFORE the body is
 * buffered. `Request#formData()` alone would let a client stream an
 * arbitrarily large body into memory. Content-Length is honored when present;
 * otherwise the raw stream is drained chunk-by-chunk so oversize bodies are
 * rejected as they arrive.
 */
export async function readCappedFormData(req: Request): Promise<FormData> {
  const declaredLength = Number(req.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_UPLOAD_REQUEST_BYTES
  ) {
    throw createApiError.payloadTooLarge(
      `Upload too large. Keep it under ${MAX_IMAGE_MB} MB (images only).`
    );
  }

  const stream = req.body;
  if (!stream) throw createApiError.badRequest("Request body is empty.");

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_UPLOAD_REQUEST_BYTES) {
        await reader.cancel();
        throw createApiError.payloadTooLarge(
          `Upload too large. Keep it under ${MAX_IMAGE_MB} MB (images only).`
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    // The raw multipart boundary is inside the body, so the original
    // Content-Type (with its boundary) must be replayed for formData() to parse.
    const contentType = req.headers.get("content-type");
    return await new Request("http://local", {
      method: "POST",
      headers:
        contentType && contentType !== "" ? { "content-type": contentType } : {},
      body: new Blob([body]),
    }).formData();
  } catch {
    throw createApiError.badRequest(
      "Submit the request as multipart form data."
    );
  }
}

/**
 * Serializes mutations per user. The upload quota check-then-insert would
 * otherwise be a TOCTOU race under concurrent requests (both read the old
 * usage, both pass, quota exceeded). The deployment is a single Node process,
 * so an in-process queue is a correct and cheap mutex.
 */
const userLocks = new Map<number, Promise<unknown>>();

export async function withUploadLock<T>(
  userId: number,
  fn: () => Promise<T>
): Promise<T> {
  const previous = userLocks.get(userId) ?? Promise.resolve();
  const run = previous.then(fn, fn) as Promise<T>;
  const tail = run.then(
    () => undefined,
    () => undefined
  );
  userLocks.set(userId, tail);
  try {
    return await run;
  } finally {
    if (userLocks.get(userId) === tail) userLocks.delete(userId);
  }
}

/**
 * Validates and stores an uploaded concern image (or resolution attachment),
 * enforcing the per-user daily byte quota configured under
 * uploads.daily_quota_bytes. Returns the generated filename; callers should
 * reference it via imageUrlForFile().
 */
export async function saveConcernImage(
  file: File,
  userId: number
): Promise<string> {
  if (file.size === 0) {
    throw createApiError.badRequest("The uploaded image is empty.");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw createApiError.badRequest(
      `The image must be ${MAX_IMAGE_MB} MB or smaller.`
    );
  }
  if (file.type && !(file.type in MIME_EXTENSION)) {
    throw createApiError.badRequest(
      "Only JPEG, PNG, or WebP images are allowed."
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const mime = sniffImageMime(buffer);
  if (!mime) {
    throw createApiError.badRequest(
      "The uploaded file is not a valid image. Executable and unsupported files are rejected."
    );
  }
  if (file.type && file.type !== mime) {
    throw createApiError.badRequest(
      "The image content does not match its declared type."
    );
  }

  const filename = `${randomUUID()}.${MIME_EXTENSION[mime]}`;

  // Quota check and accounting must be atomic per user; the in-process lock
  // closes the read-then-insert race between concurrent uploads.
  await withUploadLock(userId, async () => {
    const quota = await getUploadDailyQuotaBytes(db);
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const usage = await db.uploadRecord.aggregate({
      where: { userId, createdAt: { gte: startOfDay } },
      _sum: { bytes: true },
    });
    const usedBytes = usage._sum.bytes ?? 0;
    if (usedBytes + buffer.length > quota) {
      throw createApiError.badRequest(
        "You have reached your daily image upload limit. Try again tomorrow."
      );
    }

    const useDb = usingDatabaseUploads();

    if (useDb) {
      await db.uploadRecord.create({
        data: { userId, filename, bytes: buffer.length, data: buffer },
      });
    } else {
      const dir = getUploadDir();
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, filename), buffer);
      try {
        await db.uploadRecord.create({
          data: { userId, filename, bytes: buffer.length },
        });
      } catch (error) {
        await unlink(path.join(dir, filename)).catch(() => undefined);
        throw error;
      }
    }
  });

  return filename;
}

export function imageUrlForFile(filename: string): string {
  return `/api/v1/uploads/${filename}`;
}

export function isSafeImageFilename(filename: string): boolean {
  return SAFE_FILENAME.test(filename);
}

export function imageMimeForFilename(filename: string): string | null {
  if (!isSafeImageFilename(filename)) return null;
  const extension = filename.slice(filename.lastIndexOf(".") + 1);
  if (extension === "jpg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  return null;
}

export async function readConcernImage(
  filename: string
): Promise<Buffer | null> {
  if (!isSafeImageFilename(filename)) return null;
  try {
    const record = await db.uploadRecord.findUnique({
      where: { filename },
      select: { data: true },
    });
    if (record?.data) return Buffer.from(record.data);
    return await readFile(path.join(getUploadDir(), filename));
  } catch {
    return null;
  }
}

export async function deleteConcernImage(filename: string | null): Promise<void> {
  if (!filename || !isSafeImageFilename(filename)) return;
  // Deleting the UploadRecord drops the stored bytes with it, so this covers
  // both storage modes; the unlink is only relevant for disk-backed uploads.
  try {
    await db.uploadRecord.deleteMany({ where: { filename } });
  } catch {
    // Quota accounting cleanup is best-effort.
  }
  try {
    await unlink(path.join(getUploadDir(), filename));
  } catch {
    // Cleanup is best-effort; a missing file must not mask the real error.
  }
}
