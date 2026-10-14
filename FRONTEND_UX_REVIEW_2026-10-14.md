# Frontend / UI / UX Adversarial Review — 2026-10-14 (Phase 4)

This continues the same adversarial, fix-what's-real, evidence-backed audit used for
`AUDIT_FINDINGS_2026-10-14.md` (phase 1) and `DEFENSE_READINESS_2026-10-14.md`
(phases 2–3), now scoped to the front end: pages, UI components, and UX flows.

## Method and an upfront limitation

**There is no headless/real browser available in this sandbox.** Verified and
exhausted before starting: no `chromium`/`chrome` binary is installed, `apt-get
install chromium` fails (no root, dpkg lock permission denied), no
Playwright/Puppeteer dependency exists in the repo, and direct network access to
Playwright's/Chromium's browser-binary CDNs is blocked by the sandbox's host
allowlist (only `github.com`/npm/PyPI-family hosts are reachable). Real pixel
rendering, click interaction, and screen-reader behavior could not be exercised.

Instead, this review used three methods, and every finding below is labelled with
which one produced it:

- **Code-reviewed only** — read the component/page source and reasoned about its
  behavior; not run.
- **Live-verified (SSR/HTML)** — fetched the real route from the running dev
  server (`next dev --turbopack` on port 3100, backed by a seeded PGlite database
  reused from phases 1–3) with real role cookies, and inspected the actual
  rendered HTML/RSC payload.
- **Live-verified (server log)** — exercised a route and inspected the Next.js
  dev-server terminal for React/hydration warnings (dev mode surfaces these;
  production builds don't).

Where a UI behaves differently with JavaScript enabled after hydration (e.g. a
dialog opening), that part is necessarily code-reviewed only — no amount of curl
can click a button.

## Summary

The front end was built with real care: empty states, loading states, i18n
structure, and the primary navigation/table components are all solid. Six
genuine, fixable defects were found and fixed (four in the initial pass, two
more — accessibility wiring and validation-message localization — in a
follow-up "final fixes" pass):

1. A shared primitive (`Sheet`, the mobile "More" drawer used on every phone-width
   page) could leak keyboard focus into hidden background content, and didn't
   return focus to its trigger on close despite a code comment claiming it did.
2. Two whole client components — the phone-push-notification setup widget and,
   more narrowly, a shared confirm/delete dialog used in 7 places — were not
   wired into the i18n system at all, so a Filipino-language user would see
   English strings in the middle of localized pages.
3. The shared confirm/delete dialog had the same lost-focus-on-close defect as
   the `Sheet` component, fixed with the same technique.
4. Two stray hardcoded-English strings (a required-field placeholder and an
   image alt) on the main concern-submission form — the single page nearly every
   resident uses — right next to sibling fields on the same form that were
   already correctly localized.

Two broader, lower-priority gaps were initially documented rather than fixed
(missing `aria-describedby` wiring on form errors; Zod validation messages that
fall back to English where no custom message was supplied). Following an
explicit "do the final fixes" instruction, both have since been implemented —
see items 5 and 6 below.

---

## 1. Fixed: `Sheet` (mobile nav drawer) — focus could escape to the page behind it, and never returned on close

**File:** `src/components/ui/sheet.tsx`
**Method:** code-reviewed (focus-trap behaviour needs a real browser to click-test;
confirmed the before/after logic by reading the effect's control flow and React's
documented unmount/cleanup order).

`Sheet` is the "More" bottom-sheet opened from `MobileTabBar` on every role's
phone-width layout (nav items beyond the 4 shown as tabs). Before this review:

- It had **no keyboard focus trap**. `Tab`/`Shift+Tab` could move focus out of the
  open sheet into page content sitting behind the semi-transparent backdrop —
  content a sighted mouse user can't reach (the backdrop button sits on top of
  it visually) but a keyboard or screen-reader user could still tab into and
  activate, while believing they were still inside the open panel.
- A code comment claimed the component "returns focus to the page when it
  unmounts", but no code actually did this. When the sheet closes, the focused
  cancel/link element unmounts; by default the browser drops focus to
  `<body>`, silently resetting a keyboard user back to the top of the document
  instead of back to the "More" tab they came from.

**Fix:** added a focusable-elements scan and `Tab`/`Shift+Tab` wrap-around inside
the sheet's keydown handler (mirrors the pattern already used correctly
elsewhere in this codebase, see finding 3), and captured
`document.activeElement` on open to restore it in the effect's cleanup when the
sheet closes.

---

## 2. Fixed: phone-push-notification setup widget had zero i18n coverage

**File:** `src/components/alerts/push-setup.tsx`, wired from `src/app/alerts/page.tsx`
**Method:** live-verified (SSR/HTML) for the always-visible strings; code-reviewed
for the ~20 conditional status/error strings that only appear after a client
action (enable/disable push, permission denied, etc. — these require a real
device/browser to trigger).

The `/alerts` page already does full server-side i18n — `getLocale()` picks the
`br_lang` cookie and every sibling element (`<AlertArchive>`, headings, back
button) is localized. `<PushSetup />` was rendered right next to all of it but
accepted no `locale` prop and had **every one of its ~25 strings hardcoded in
English** — the button label ("Enable/Disable phone alerts"), the "Working…"
busy state, the Mode/Status lines, and every diagnostic message (permission
denied, server not configured, offline, etc.). A Filipino-language user would
hit a wall of English text the moment they tried to turn on alerts, which is
jarring in an otherwise fully bilingual app.

**Fix:** added a `push: {...}` i18n sub-namespace (en + fil, ~25 keys each) under
`copy.*.alerts`, added a `locale` prop to `PushSetup` (default `"en"` to stay
backward-compatible), and replaced every hardcoded string with the matching
`t.*` lookup. `alerts/page.tsx` now passes `locale={locale}` through.

**Live-verified:** fetching `/alerts` with `br_lang=fil` now returns
*"I-enable ang push alert sa telepono"* in the rendered HTML where it previously
said *"Enable phone alerts"*.

**Scope note, not fixed:** `src/components/alerts/native-diagnostics-card.tsx`
(rendered on the same page) is also fully hardcoded in English. Checked its
guard condition directly: it calls `if (!native) return null;` and `isNativeShell()`
is only true inside the Android Capacitor wrapper — in any browser (which is 100%
of what a live demo on a laptop/phone browser would show), this component
renders nothing at all. It is not reachable in the testing/demo scenario that
matters here, so it was left as a documented, low-priority gap rather than spending
further time localizing a panel nobody browsing the live site will ever see.

---

## 3. Fixed: shared confirm/delete dialog leaked English "Cancel"/"Working..." and didn't return focus on close

**File:** `src/components/ui/confirm-action-button.tsx`, used from 6 files (7 call
sites: category manager, office manager, routing-rules manager, settings manager,
user manager ×2, alert archive).
**Method:** code-reviewed for the fix itself (the dialog only renders after client
state flips to `open === true`, so its interior is not visible to SSR curl by
design — confirmed this directly: fetched `/admin/users` and `/alerts` with both
`en` and `fil` cookies and verified the dialog's `title`/`description`/
`confirmLabel` text is genuinely absent from both the raw HTML and the RSC flight
payload in *either* locale, because unopened conditional JSX produces no output
at all — not a localization bug, just an SSR-visibility limit of this component).
TypeScript (`tsc --noEmit`) and ESLint are both clean on the change, and all 778
passing Vitest tests still pass.

This is the primitive behind every "Delete this category/office/account/alert" and
"Reset password" confirmation in the admin area. Two real defects, both fixed:

- **i18n:** the component had hardcoded English defaults `confirmLabel = "Confirm"`,
  `cancelLabel = "Cancel"`, and an unconditionally-English `"Working..."` busy
  label with no prop to override it at all. Every one of the 7 call sites already
  had a localized `t` object in scope (they localize the trigger label, title, and
  confirm label) but — before this fix — 6 of the 7 never passed `cancelLabel`,
  and *none* could pass a busy label since the prop didn't exist. Net effect: a
  Filipino-language admin deleting a user, resetting a password, or removing a
  community alert would see "Cancel" and "Working..." in English inside an
  otherwise fully-Filipino confirmation dialog.
  Fix: added a `busyLabel` prop (default `"Working..."`, same backward-compatible
  pattern as `PushSetup`'s `locale` default); added `cancelAction`/
  `workingEllipsis` keys to the `admin.mgr` and `alerts` i18n namespaces (en + fil);
  wired `cancelLabel`/`busyLabel` into all 7 call sites.
- **Focus restore:** same root defect as the `Sheet` component (finding 1) —
  closing the dialog unmounts the focused Cancel/Confirm button and focus fell
  back to `<body>` instead of the trigger. Fixed with a dedicated effect keyed
  only on the `open` boolean (specifically *not* re-triggered by the `busy`
  state flips that happen while the dialog is still open mid-confirm, and
  specifically *not* firing on initial mount — both of which were real risks in
  a naive implementation and were checked for before landing the fix).

The dialog's own existing focus-trap (`Tab`/`Shift+Tab` cycling between Cancel and
Confirm) was already correct — it was the one place in the codebase that had this
right before this review, and the `Sheet` fix in finding 1 was modeled on it.

---

## 4. Fixed: two stray hardcoded-English strings on the main concern-submission form

**File:** `src/components/concern/submit-concern-form.tsx` (the highest-traffic
resident-facing page in the app — every concern report goes through it).
**Method:** live-verified (SSR/HTML). Both strings are unconditionally rendered
(not gated behind client `open` state like the dialog in finding 3), so they are
directly visible in server-rendered HTML.

Found while sweeping this form for alt-text and `<option>` placeholder coverage:

- The disabled placeholder option for every priority-scoring `<select>`
  ("urgency", "impact", etc. — a required field on every single submission) was
  hardcoded `"Select a rating"`, while the sibling category and area dropdowns on
  the same form correctly used `{t.categoryPlaceholder}` / `{t.areaPlaceholder}`.
- The alt text on the photo preview thumbnail was hardcoded `alt="Selected proof"`.

Both are one-off oversights, not a systemic pattern — the rest of this form (and
the category/area dropdowns right next to the broken one) is fully localized,
which is exactly why they were worth finding: a Filipino-language resident would
hit English text in the middle of an otherwise fully-Filipino form, on the one
page nearly every resident uses.

**Fix:** added `selectRating` and `imageAlt` keys to the `submit` i18n namespace
(en + fil) and wired both into the form.

**Live-verified:** fetching `/resident/concerns/new` with the Filipino cookie now
shows "Pumili ng rating" (4 occurrences, one per scoring factor) where it
previously said "Select a rating" 4 times; `tsc`/`eslint` clean; all 778 tests
still pass; dev-server log shows a clean compile with no warnings.

---

## 5. Fixed: form field errors weren't wired via `aria-describedby`

**Files:** `src/components/ui/field.tsx` (`FieldError`/`FieldHint` now accept an
optional `id` prop), plus all 17 files that render `<FieldError>`:
`admin/privacy-desk.tsx`, `admin/verification-review.tsx`,
`auth/login-form.tsx`, `auth/password-form.tsx`, `auth/profile-form.tsx`,
`auth/register-form.tsx`, `auth/reset-password-form.tsx`,
`cases/case-note-form.tsx`, `cases/case-workflow-form.tsx`,
`cases/track-case-form.tsx`, `concern/submit-concern-form.tsx`,
`identity/verification-form.tsx`, `priority/priority-override-form.tsx`,
`privacy/dsr-form.tsx`, `routing/reassign-form.tsx`,
`treasury/allocation-form.tsx`, plus `sla/policy-form.tsx` (reviewed and
intentionally left alone — its one `<FieldError>` renders a form-level
submission error, not a message tied to a specific field, so there is no
single input to point `aria-describedby` at).

**Method:** code-reviewed and hand-wired (44 sites), then live-verified
(SSR/HTML) and via the dev-server log.

`Input`/`Select`/`Textarea`/checkboxes already set `aria-invalid` correctly and
`FieldError` already used `role="alert"`, but nothing pointed the control at the
error message's `id`, so a screen reader re-focusing an already-invalid field
announced only "invalid" without repeating what's wrong. Every one of the 44
sites was updated to the standard pattern: the control gets
`aria-describedby={condition ? "field-error" : undefined}` and the paired
`<FieldError id="field-error">` carries the matching id. Two bonus cases also
got the same treatment for their *hint* text so the association exists even
before an error appears (`track-case-form.tsx`'s case-number/email hints,
`identity/verification-form.tsx`'s ID-number/ID-photo hints,
`treasury/allocation-form.tsx`'s appropriation-amount hint, which required
adding the same optional `id` prop to `FieldHint`). Dynamic/repeated fields
(the per-factor priority rating in `submit-concern-form.tsx`, the per-request
reason field in `admin/verification-review.tsx`) use a template-literal id keyed
off the row's existing unique key, so ids stay unique across repeated rows.

**Verified:** `tsc --noEmit` and `eslint .` both clean; all 778 tests still
pass; dev-server log shows clean compiles for `/login`, `/register`, `/track`,
and other touched pages with no new warnings; spot-checked the rendered HTML
(`curl`) and confirmed, e.g., `track-case-form.tsx`'s case-number input renders
`aria-describedby="caseNumber-hint"` pointing at the hint paragraph by default,
switching to `caseNumber-error` once a validation error is set.

## 6. Fixed: hardcoded/non-localized validation fallback text

**Files:** `src/lib/i18n.ts` (new `invalidValue` key added to both the `login`
and `register` namespaces, English and Filipino), `auth/login-form.tsx`,
`auth/register-form.tsx` (both now use `t.invalidValue` instead of the literal
string `"Invalid value"`), `src/lib/validations/auth.ts` (`optionalString`
helper — used for `address`/`position` in the register and profile forms — now
has an explicit `.max(255, "Must be at most 255 characters.")` message instead
of relying on Zod's framework-default English message), `src/lib/validations/admin.ts`
(`officeUpdateSchema.name` and `categoryUpdateSchema.name` now carry the same
explicit messages their sibling *create* schemas already had).

Grepped the whole `src/` tree for the literal string `"Invalid value"` after
the fix and confirmed zero remaining hits outside `i18n.ts` itself.

**Known, accepted limitation (not fixed):** dozens of other bare Zod validators
across the codebase (mostly numeric `.int()`/`.positive()`/`.max()` constraints
on admin/internal fields — office IDs, crew capacity, priority score bounds,
routing order, treasury amounts, push-subscription payload lengths) still fall
back to Zod's default English error text when no custom message is supplied.
Fixing every one of them, or wiring a global Zod locale-aware error map, would
be a cross-cutting change touching ~10 validation files well beyond what this
pass's two flagged items called for. These fields are overwhelmingly
admin/office-staff-facing (not the resident-facing concern/track/register
forms, which were the priority and are now fully covered), and the English
fallback text is still comprehensible, just not translated — a cosmetic
inconsistency rather than a usability blocker. Documented here as a known,
intentionally deferred limitation rather than silently left unmentioned.

**Verified:** `tsc --noEmit` and `eslint .` both clean; all 778 tests pass.

---

## Positive findings (reviewed, no defect — recorded so the "why wasn't X checked"
question has an answer)

- **Alt text is correct everywhere it was checked:** every `<Image>`/`<img>` in
  the app either has meaningful, often dynamic alt text (localized hero image,
  per-case-number proof photos) or is explicitly `alt=""` where decorative (map
  tiles) — no missing or empty-by-omission alt text found.

- **Empty-state handling** is thorough and correct across all 63 list-rendering
  components surveyed, including distinguishing "no results for your filter" from
  "nothing here yet" (e.g. resident/official concern lists, notifications inbox,
  audit log, treasury ledger, escalations, user manager, approvals queue,
  earmarks). Two components (`treasury/earmark-review.tsx`,
  `treasury/funding-panel.tsx`) silently omit a section instead of showing an
  explicit empty message when its data is empty — a cosmetic polish item, not a
  bug.
- **i18n structural completeness is compiler-enforced, not just convention:**
  `const fil: typeof en = {...}` in `src/lib/i18n.ts` means TypeScript itself
  fails the build if the Filipino object is missing a key the English object has
  — there is no possible "silently falls back to English because someone forgot
  a key" failure mode for anything inside the `copy` object itself (the two gaps
  found above were both components that never plugged into `copy` at all, which
  this guarantee cannot catch — that is exactly why they were found by component
  audit rather than by the type system). Spot-checked `fil` content directly
  (not just key names) and confirmed it is genuine, fluent Filipino, not
  copy-pasted English.
- **Page-level i18n coverage is 64/64** (`find src/app -name page.tsx` vs. grep for
  the `@/lib/i18n` import) — every page in the app localizes at the page level.
  The 4 admin report pages that don't import `copy` directly delegate rendering to
  `ReportScreen`, which does.
- **Accessible mobile tab bar:** `src/components/ui/mobile-tab-bar.tsx` has
  `aria-label` on the nav, `aria-current="page"` on the active tab, icons marked
  `aria-hidden` paired with a visible text label (never icon-only), `aria-expanded`/
  `aria-haspopup="dialog"` on the "More" trigger, and closes the "More" sheet
  automatically on route change — a classic SPA mobile-menu bug (stale open menu
  after navigating) that was already prevented.
- **Responsive tables use two legitimate strategies, both implemented correctly:**
  (a) a CSS `[data-stack]`/`[data-label]` attribute pattern (`content:
  attr(data-label)`) that turns a `<table>` into stacked cards below `md`, used by
  8 tables; (b) a dual-render pattern — a `<ul>` card list shown `md:hidden` next
  to a `<table>` shown `hidden md:block` — used by the two highest-traffic tables
  (`resident/concerns`, `official/concerns`). Of the remaining tables that use
  neither, all but one wrap the table in `overflow-x-auto` (admin utility tables:
  category/crew/permission-matrix/routing-rules/settings/user manager, audit
  table, treasury ledger) so nothing breaks the page layout, only requires a
  horizontal scroll on very narrow screens. The sole exception
  (`priority/priority-breakdown.tsx`) is a fixed 4-row scoring table with short
  labels/single-digit numbers that cannot realistically overflow.
- **Form double-submit protection exists client-side, in addition to the
  server-side rate limit fixed in phase 3:** `submit-concern-form.tsx`'s submit
  button is `disabled={submitting}` with `loading={submitting}`, and the shared
  `Button` component sets `aria-busy` and shows a spinner while loading — so a
  double-click on "Submit" is already blocked by the UI, not just by the server.
- **Error/404 boundaries exist and offer real recovery**, not a blank screen:
  `error.tsx` has a "Try again" (calls Next's `reset()`) and "Back to home";
  `global-error.tsx` covers root-layout-level crashes; `not-found.tsx` has a
  link home. All three are hardcoded English with no `locale` plumbing — judged
  acceptable and not fixed: error boundaries are a case where keeping the
  component simple/dependency-free is a legitimate tradeoff (a broken locale
  cookie or server function must not be able to break the crash screen itself),
  and this is a common, defensible pattern even in bilingual products. Flagging
  it here so it's a documented decision, not a missed gap.
- **8 route-level `loading.tsx` files** exist for Suspense-boundary loading states
  on the heavier data pages.

---

## Carried-over open item (not part of this phase)

Phase 3 gap #4 — whether the notes/resolutions/field-checks endpoints have an
IDOR (can one office/role fetch another's case notes/resolutions by guessing an
ID) — was flagged in `DEFENSE_READINESS_2026-10-14.md` as not yet exhaustively
verified, and was never investigated before the user pivoted to this frontend
phase. It remains open and should be revisited if backend hardening work
resumes.

---

## Verification evidence log

- `npx tsc --noEmit` — clean, no errors, across all changed files.
- `npx eslint <changed files>` — clean, no warnings.
- `npx vitest run` — 778/778 actual test cases pass (13 test *files* fail only on
  a pre-existing `PrismaClientInitializationError` because vitest doesn't have the
  PGlite driver adapter wired in the way the live dev server does — the same
  environment artifact seen in earlier phases, not a regression).
- Live SSR fetch of `/alerts` with `br_lang=fil` cookie: confirmed rendered HTML
  contains "I-enable ang push alert sa telepono" (was "Enable phone alerts").
- Live SSR fetch of `/resident/concerns/new` with `br_lang=fil`: confirmed
  rendered HTML contains "Pumili ng rating" ×4 and zero occurrences of "Select a
  rating".
- Live SSR fetch of `/resident/concerns`, `/official/concerns`,
  `/captain/escalations`, `/treasury/ledger`, `/admin/users`,
  `/resident/concerns/new` (en and fil) — all `200`, `next dev` terminal log
  shows clean compiles with **no React/hydration warnings** after every one of
  these fetches.
- Confirmed via direct SSR/flight-payload inspection (not assumption) why the
  `ConfirmActionButton` dialog's interior strings can't be curl-verified: the
  component gates its dialog body behind client-side `open` state, so unopened
  dialog content is absent from both the HTML and the RSC payload in any locale
  — a testing-method limitation, not a product defect.
- **Final-fixes pass (items 5–6 above):** re-ran `npx tsc --noEmit`, `npx eslint
  .` (whole repo, not just changed files) and `npx vitest run` after every edit
  — all clean, 778/778 tests passing, matching the pre-change baseline exactly.
  Grepped `src/` for `<FieldError` vs. `<FieldError id=` to mechanically confirm
  all 44 real render sites (the 45th/46th grep hits were `useState`/import
  declarations, not renders) now carry an id. Grepped `src/` for the literal
  string `"Invalid value"` and confirmed zero hits outside `i18n.ts`. Live
  SSR-fetched `/login`, `/register`, `/track` after the edits and confirmed the
  dev-server log shows clean compiles with no new errors or warnings, and that
  `track-case-form.tsx`'s case-number input renders the expected
  `aria-describedby="caseNumber-hint"` by default in the actual HTML.
