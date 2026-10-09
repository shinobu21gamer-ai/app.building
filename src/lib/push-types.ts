/** Counts of alert push requests handed off to each provider. Provider acceptance
 * is not a guarantee that a powered-off or disconnected device received it. */
export interface PushPlatformReport {
  registered: number;
  accepted: number;
  failed: number;
  /** Stale subscriptions/tokens the provider rejected as no longer valid; they were removed, not a delivery failure. */
  pruned: number;
  skipped: number;
  configured: boolean;
  reason?: string;
}

export interface SystemAlertPushReport {
  web: PushPlatformReport;
  android: PushPlatformReport;
  ios: PushPlatformReport;
}
