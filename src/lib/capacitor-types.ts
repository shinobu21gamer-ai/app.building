import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";

export { PushNotifications };

export type PushPlatform = "android" | "ios";

export function getPushMode(): "web" | "capacitor" | "unknown" {
  if (typeof window === "undefined") return "unknown";
  return Capacitor.isNativePlatform() ? "capacitor" : "web";
}

export function getNativePlatform(): PushPlatform {
  return Capacitor.getPlatform() === "ios" ? "ios" : "android";
}

export interface NativeAlertPayload {
  alertId?: number | string;
  /** Legacy native payload key, accepted during APK upgrades. */
  id?: number | string;
  title?: string;
  body?: string;
  message?: string;
  severity?: "INFO" | "WARNING" | "CRITICAL";
  sound?: boolean | string;
  createdAt?: string;
  expiresAt?: string | null;
}

export interface AlertView {
  id: number;
  title: string;
  message: string;
  severity: string;
  sound: boolean;
  createdAt: string;
  expiresAt: string | null;
  acknowledged: boolean;
  reactions: Record<string, number>;
}

export function toNativeAlertView(data: NativeAlertPayload): AlertView {
  const rawId = data.alertId ?? data.id;
  const parsedId = typeof rawId === "number" ? rawId : Number(rawId);
  return {
    id: Number.isSafeInteger(parsedId) && parsedId > 0 ? parsedId : Date.now(),
    title: data.title || "BarangayResolve Alert",
    message: data.body || data.message || "You have a new alert",
    severity: data.severity || "INFO",
    sound: data.sound !== false && data.sound !== "false",
    createdAt: data.createdAt || new Date().toISOString(),
    expiresAt: data.expiresAt || null,
    acknowledged: false,
    reactions: {},
  };
}

export const SEVERITY_CHANNELS = {
  INFO: { id: "alerts_info", name: "Alerts (Info)", importance: 3, sound: "alert_info_long" },
  WARNING: { id: "alerts_warning", name: "Alerts (Warning)", importance: 4, sound: "alert_warning_long" },
  CRITICAL: { id: "alerts_critical", name: "Alerts (Critical)", importance: 5, sound: "alert_critical_long" },
} as const;

export async function ensureSeverityChannels(): Promise<void> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") return;
  for (const channel of Object.values(SEVERITY_CHANNELS)) {
    try {
      await PushNotifications.createChannel({
        id: channel.id,
        name: channel.name,
        description: "BarangayResolve alert severity channel",
        importance: channel.importance,
        visibility: 1,
        vibration: true,
        lights: true,
        lightColor: channel.id === "alerts_critical" ? "#DC2626FF" : channel.id === "alerts_warning" ? "#D97706FF" : "#2563EBFF",
        sound: channel.sound,
      });
    } catch (error) {
      // A channel that already exists (or a transient error) must never block
      // FCM registration — the alarm sound/vibration do not depend on it.
      console.warn("[push] could not create channel", channel.id, error);
    }
  }
}

export function severityChannelId(severity: string | undefined): string {
  if (severity === "CRITICAL") return SEVERITY_CHANNELS.CRITICAL.id;
  if (severity === "WARNING") return SEVERITY_CHANNELS.WARNING.id;
  return SEVERITY_CHANNELS.INFO.id;
}

const NATIVE_TOKEN_KEY = "barangayresolve.nativePushToken";

export function rememberNativeToken(token: string): void {
  try {
    localStorage.setItem(NATIVE_TOKEN_KEY, token);
  } catch {}
}

export function readNativeToken(): string | null {
  try {
    return localStorage.getItem(NATIVE_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function forgetNativeToken(): void {
  try {
    localStorage.removeItem(NATIVE_TOKEN_KEY);
  } catch {}
}

// AlertBridge interface for web-to-native communication
export interface AlertBridge {
  stopAlertSound(): void;
  stopAlertSoundFor(alertId: number): void;
  stopAlertFor(alertId: number): void;
  startAlertFor(alertId: number, title: string, message: string, severity: string, sound: boolean): void;
  openAlertsPage(): void;
  openAlertPermissions(): void;
  /**
   * Mirrors the web session into the native layer. The alarm runs in a
   * foreground service Android can start while the app is backgrounded, so it
   * cannot read the WebView session itself — this is how it learns whether
   * anyone is signed in.
   */
  setSessionActive(active: boolean): void;
}

// Extend Window interface for AlertBridge
declare global {
  interface Window {
    AlertBridge?: AlertBridge;
  }
}
