import { apiRequest } from "@/lib/api-client";
import { getNativePlatform, readNativeToken } from "@/lib/capacitor-types";
import { readPushDiagnostics } from "@/lib/native-diagnostics";

export type NativeServerState = {
  registered: boolean;
  serverConfigured: boolean;
  projectId: string | null;
};

/** Exact-device check. Tokens travel only in the authenticated request body,
 * never in a URL/loggable query string or in the response. */
export function currentNativeToken(): string | null {
  return readNativeToken() || readPushDiagnostics()?.lastToken || null;
}

export async function checkNativePushStatus() {
  return apiRequest<NativeServerState>("/api/v1/alerts/push/status", {
    method: "POST",
    body: JSON.stringify({ token: currentNativeToken(), platform: getNativePlatform() }),
  });
}
