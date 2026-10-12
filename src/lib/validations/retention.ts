import { z } from "zod";

// Retention sweep intake. The admin trigger is deliberately narrow: a policy
// key to narrow the sweep, and a force flag to ignore the once-a-day guard.

export const retentionRunSchema = z.object({
  policy: z.string().trim().min(1).max(120).optional(),
  force: z.boolean().optional(),
});

export type RetentionRunInput = z.infer<typeof retentionRunSchema>;
