const KEY = "barangayresolve.nativePushEnabled";
let optedOutInMemory = false;
/** Resume/reconnection recovery must never silently undo a deliberate opt-out. */
export function nativePushOptedOut(): boolean {
  try { return localStorage.getItem(KEY) === "false" || optedOutInMemory; }
  catch { return optedOutInMemory; }
}
export function setNativePushEnabled(enabled: boolean): void {
  optedOutInMemory = !enabled;
  try { localStorage.setItem(KEY, String(enabled)); } catch { /* blocked storage */ }
}
