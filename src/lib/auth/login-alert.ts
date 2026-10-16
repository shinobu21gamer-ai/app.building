/** Detect a login context change from the audit record for the prior successful sign-in. */
export function isNewLoginContext(
  previous: { userAgent: string | null; ip: string | null } | null | undefined,
  current: { userAgent: string | null; ip: string | null }
): boolean {
  if (!previous) return false;
  const previousAgent = previous.userAgent?.trim();
  const currentAgent = current.userAgent?.trim();
  const differentBrowser = Boolean(
    previousAgent && currentAgent && previousAgent !== currentAgent
  );
  const differentNetwork = Boolean(previous.ip && current.ip && previous.ip !== current.ip);
  return differentBrowser || differentNetwork;
}
