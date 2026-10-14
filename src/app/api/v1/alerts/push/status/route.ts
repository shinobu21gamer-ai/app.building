import { db } from "@/lib/db";
import { assertSameOrigin, ok, parseBody, withErrorBoundary } from "@/lib/api";
import { requireApiUser } from "@/lib/auth/session";
import { nativePushConfiguration } from "@/lib/push";
import { nativePushStatusSchema } from "@/lib/validations/native-push";

export const runtime = "nodejs";
export const POST = withErrorBoundary(async (req: Request) => {
  assertSameOrigin(req);
  const user = await requireApiUser();
  const input = await parseBody(req, nativePushStatusSchema);
  const registration = input.token ? await db.nativePushToken.findFirst({
    where: { userId: user.id, token: input.token, platform: input.platform, active: true },
    select: { id: true },
  }) : null;
  return ok({ registered: Boolean(registration), ...await nativePushConfiguration(input.platform) }, {
    headers: { "Cache-Control": "no-store" },
  });
});
