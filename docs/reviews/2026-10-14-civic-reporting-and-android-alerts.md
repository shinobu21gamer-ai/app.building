# Civic reporting UX review and Android alert investigation

Reviewed: 14 October 2026. Scope: repository code and published reference-site
content, not a visual browser audit of the deployed application. This sandbox
has no live application database, Android SDK/phone, Firebase Android config,
or server Firebase credentials. Provider delivery tests use mocks. No deployed
settings were changed and no new APK was built.

## Real-world references

- **Merton Council / FixMyStreet:** official FAQ reviewed directly. Location-first
  reporting, checking existing reports, progress updates, and a clear separation
  of emergencies from routine reports. [3](https://fixmystreet.merton.gov.uk/faq)
- **FixMyStreet Pro:** published manual describes duplicate suggestions and
  offline drafts that are resumed and submitted manually, not automatically.
  [1](https://fixmystreet.org/pro-manual/print/)
- **SeeClickFix / Chelmsford:** official search result describes a location →
  category → details workflow, email acknowledgement/progress, and an explicit
  non-emergency warning. The page fetch returned the loading shell, so this
  comparison relies on the official search excerpt, not an inspected embedded
  form. [3](https://www.chelmsfordma.gov/524/SeeClickFix)

The goal is to adopt useful interaction patterns, not copy branding or weaken
this project's consent, role, proof-photo, or personal-data requirements.

## Improvement checklist

| Area | Repository finding | Action / status |
|---|---|---|
| Emergency boundary | Public pages have emergency copy, but the concern form needed it at the decision point | **Applied:** emergency guidance immediately before the submission form |
| Actionable location | GPS is optional; staff still need a useful written location | **Applied:** purok, landmark, and clear-photo guidance |
| Private information | Users can accidentally include unnecessary identifiers or people in proof | **Applied:** privacy guidance at intake; no new public access to resident reports |
| Losing form work | No draft controls in the submission form | **Applied:** manual, opt-in, resident-scoped text drafts in `sessionStorage`, 24-hour expiry, restore/discard, cleared on successful submission and sign-out |
| Connectivity | Failed submission is especially confusing inside an APK | **Applied:** offline notice; drafts can be saved after the form has loaded. This is **not** a full offline app and does not save files or GPS pins |
| Validation | Inline errors required hunting down fields | **Applied:** linked error summary and focus on the first invalid field |
| Finding old reports | Resident list loaded every concern without filtering/paging | **Applied:** title/case-number search, status filtering, 20-row pages, stable ordering, and localized controls; every query remains scoped to the signed-in resident |
| Duplicate prevention | Public-style nearby suggestions could leak private cases | **Applied now:** link to check the resident's existing concerns. **Next:** privacy-reviewed matching against the PII-free public projection, not raw concern records |
| Progress clarity | Existing workflow, case journal, and public projection already describe case progress | **Retained:** no extra status taxonomy or promises of response times invented |
| Phone readiness | Registration, account session, provider configuration, and delivery were conflated | **Applied:** exact-device diagnostics, registration retry, project identity, safe masked diagnostic copy, and an authenticated one-phone test |

## Android alert bugs fixed in code

1. **Bridge timing:** `PushSessionSync` could call `setSessionActive` before
   `AlertBridge` existed; the native layer then retained its previous state.
   It now waits for the bridge and prevents an older layout/refresh from
   overwriting a newer sign-in result.
2. **Incorrect sign-out inference:** transient server failures could be treated
   as "signed out", suppressing native alarms. Only an explicit `UNAUTHORIZED`
   response now changes the session to signed out.
3. **Stale cached tokens:** startup could persist a localStorage token and stop,
   never asking Firebase whether that token rotated while the app was closed.
   Startup/resume/reconnect now asks for the current native token.
4. **Failure latch:** failed registration could prevent retry, and repeated
   events containing the same token were discarded even after a failed server
   save. Both are retryable now.
5. **Invisible timeout:** the banner auto-dismissed while registering; a later
   timeout could remain invisible. Failures now reveal the banner again, and
   the legacy plugin path also has a timeout.
6. **Wrong-phone diagnostics:** the old GET looked for any active token owned
   by the account. New diagnostics use an authenticated body containing the
   exact token; tokens are never put in URLs or returned in status responses.
7. **Server configuration fallback:** an obsolete local service-account path
   prevented a valid inline deployment configuration from being tried. The
   server now falls back to inline JSON and validates the RSA key and expected
   fields before claiming it is configured.
8. **Cold-start OAuth fan-out:** broadcasting to multiple phones could request
   one Google access token per phone. Concurrent deliveries share one exchange.
   OAuth and FCM network calls now have bounded timeouts.
9. **Respect explicit opt-out:** resume/reconnection retries no longer override
   a phone-alert disable action. Only an explicit enable/register action resumes it.

### One-phone test

`POST /api/v1/alerts/push/test` requires authentication, same-origin protection,
and an exact active token owned by the caller. It uses a durable per-account
one-minute cooldown. It does **not** create a SystemAlert, broadcast to other
residents, start an emergency alarm, or require an acknowledgement. Its short-
lived data message omits `alertId`, using the existing Android service's plain
notification path. Provider acceptance is explicitly **not proof of receipt**.

Errors distinguish missing server configuration, a stale token, mismatched
Firebase projects, and provider permissions. Only an explicitly rejected stale
token is deactivated; connectivity/configuration errors do not delete it.

## Phone/deployment verification checklist

After deploying these changes:

1. Open the installed app, sign in, and open **Alerts → Alert diagnostics**.
2. Verify the APK reports Firebase configured/initialized. If not, rebuild with
   the matching `android/app/google-services.json`; keep that file outside Git.
   An APK built without the config cannot be repaired by changing the website.
3. Verify **this phone** is registered; use **Register this phone again**, then
   Refresh if needed.
4. Verify server credentials are configured. On Vercel, configure
   `FIREBASE_SERVICE_ACCOUNT` in the hosting environment, not a local file path.
   Never paste the private key or service-account JSON into chat.
5. The Android app configuration and the server sender must use compatible
   Firebase project/sender settings. The test explains a sender mismatch.
6. Allow notifications in Android Settings → Apps → BarangayResolve →
   Notifications. Review the app's notification channels and battery restrictions.
7. Use **Send test to this phone**, check the notification tray, and repeat after
   the cooldown with the app backgrounded. No real emergency is broadcast.
8. Do not force-stop the app during testing: Android suppresses delivery to
   force-stopped applications until they are reopened. Offline/powered-off
   phones cannot receive immediately.
9. Test a real admin broadcast separately with consenting test recipients,
   covering foreground, background, locked-screen, and acknowledgement flows.
10. If delivery still fails, share the **masked diagnostics** and exact test error,
    not tokens, private keys, passwords, or account credentials.

## Highest-value next work

- **Durable delivery outbox and device receipts:** retry failed broadcasts after
  serverless termination; distinguish queued, provider-accepted, received, and
  acknowledged. This needs database/worker design and deployment verification.
- **Case-update push:** ordinary case notifications currently go to the in-app
  notification table; they are not the same as admin emergency broadcasts.
  Add opt-in, consent-aware, post-commit delivery through an outbox rather than
  contacting a provider inside a database transaction.
- **Privacy-safe duplicate suggestions:** coarse location/category matching
  against approved public data, without leaking private residents' reports.
- **Real-device release acceptance:** Android 13+ notification permission,
  battery-saving restrictions, background delivery, and Firebase sender tests
  on a signed build; CI fixture builds cannot prove production delivery.
- **Production operations:** backup/restore drill, upload retention/storage
  monitoring, error monitoring, and measured response-time targets.

No claim is made that the user's currently installed APK or live Firebase
project is fixed until the device/deployment checklist has been executed.

## Verification completed

- `npx vitest run`: **83 files / 939 tests passed**.
- `npx tsc --noEmit`: passed.
- `npx eslint src vitest.config.mts`: no errors; one existing `<img>` warning.
- `git diff --check`: passed.
- New regression coverage includes native bridge timing, stale-token refresh,
  retries and opt-out, exact-token ownership, self-test cooldown, provider error
  handling, shared OAuth exchange, resident-scoped search, and private drafts.
- Not executed: live database integration, production deployment, a new APK
  build, or real Firebase/phone delivery.
