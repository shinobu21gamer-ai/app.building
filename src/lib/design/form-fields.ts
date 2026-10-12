// The single source of truth for "does this field need a value?".
//
// A form must mark every field its schema requires with a `*` (see
// `Label`'s `required` prop and `RequiredLegend`). Doing that by hand across
// dozens of forms is how a marker quietly goes missing, so the rule is derived
// here from the schema itself and checked in `form-fields.test.ts` against the
// forms' own markup.

import { z } from "zod";

export type FieldSpec = {
  name: string;
  /** True when the schema rejects `undefined`: the field must be sent. */
  required: boolean;
};

type Shape = Record<string, z.ZodTypeAny>;

/**
 * The object's fields, whichever way the installed Zod exposes them. Zod 4
 * keeps `shape` as a property; older spellings put it on `_def`, sometimes as
 * a function. Refinements do not change the answer in Zod 4 (they are checks
 * on the same object schema), but a schema that is not an object has no fields.
 */
function shapeOf(schema: z.ZodTypeAny): Shape | null {
  const candidate = schema as unknown as {
    shape?: unknown;
    _def?: { shape?: unknown };
  };

  const direct = candidate.shape;
  if (direct && typeof direct === "object") return direct as Shape;

  const fromDef = candidate._def?.shape;
  if (typeof fromDef === "function") return (fromDef as () => Shape)();
  if (fromDef && typeof fromDef === "object") return fromDef as Shape;

  return null;
}

/**
 * Required means "the schema rejects `undefined`". A nullable field is still
 * required: the value may be `null`, but the form has to send the field.
 */
export function isRequiredField(schema: z.ZodTypeAny, name: string): boolean {
  const shape = shapeOf(schema);
  const field = shape?.[name];
  if (!field) return false;
  return !field.safeParse(undefined).success;
}

export function fieldManifest(schema: z.ZodTypeAny): FieldSpec[] {
  const shape = shapeOf(schema);
  if (!shape) return [];

  return Object.entries(shape).map(([name, field]) => ({
    name,
    required: !field.safeParse(undefined).success,
  }));
}

export function requiredFieldNames(schema: z.ZodTypeAny): string[] {
  return fieldManifest(schema)
    .filter((field) => field.required)
    .map((field) => field.name);
}

export function optionalFieldNames(schema: z.ZodTypeAny): string[] {
  return fieldManifest(schema)
    .filter((field) => !field.required)
    .map((field) => field.name);
}
