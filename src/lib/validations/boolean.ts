import { z } from "zod";

/**
 * Accepts a real boolean or the literal strings "true"/"false" and returns a
 * boolean. Unlike z.coerce.boolean(), this does NOT turn "false", "0", "" or
 * "no" into true, which silently flipped disable operations into enables.
 */
export const booleanFlag = z.preprocess(
  (value) => {
    if (value === undefined) return undefined;
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true" || normalized === "1") return true;
      if (normalized === "false" || normalized === "0") return false;
    }
    return value;
  },
  z.boolean()
);