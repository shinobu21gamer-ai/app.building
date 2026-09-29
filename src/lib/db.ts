import { PrismaClient } from "@prisma/client";

// PrismaClient is instantiated once and cached globally so hot-reloading
// in development does not exhaust the database connection pool.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}