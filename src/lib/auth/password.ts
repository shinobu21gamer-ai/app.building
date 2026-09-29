import bcrypt from "bcryptjs";

const BCRYPT_ROUNDS = 12;

/** Hashes a password. Never store plain text. */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/** Verifies a password against its stored hash. */
export async function verifyPassword(
  password: string,
  passwordHash: string
): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}

/**
 * Dummy hash used to equalize response timing when the email does not exist,
 * preventing user enumeration via timing differences.
 */
export const DUMMY_PASSWORD_HASH = bcrypt.hashSync("dummy-password", BCRYPT_ROUNDS);