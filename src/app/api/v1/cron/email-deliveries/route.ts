import { NextResponse } from "next/server";
import { retryPendingEmailDeliveries } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const authorization = req.headers.get("authorization");
  return authorization === `Bearer ${secret}`;
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Unauthorized." } },
      { status: 401 }
    );
  }

  try {
    const sent = await retryPendingEmailDeliveries();
    return NextResponse.json({ success: true, data: { sent } });
  } catch (error) {
    console.error("[cron] email delivery retry failed:", error);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "Retry job failed." } },
      { status: 500 }
    );
  }
}
