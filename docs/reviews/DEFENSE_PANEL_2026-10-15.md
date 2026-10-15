# BarangayResolve — five-panelist defense review (2026-10-15)

This is a fullstack expert review of the **current codebase**, written as if
five panelists will examine a live demo. It is not a substitute for a timed
walkthrough on a running database.

**Verdict: defense-ready if scoped honestly. Not production-certified.**

The core product exists, is role-split, and is more complete than most
barangay capstones. A panel will pass it if the student **does not overclaim**.
A panel will fail it if the student calls it Katarungang Pambarangay, an SMS
system, a full e-barangay, or a finished COA deployment.

---

## 1. What this system actually is

BarangayResolve is a **community-concern workflow**: residents file
infrastructure and service issues (roads, drainage, waste, lights, public
places); the hall inspects, scores priority, routes, funds when needed,
dispatches crew, records proof, and closes.

It is **not**:

| Claim a panelist may assume | Reality |
|---|---|
| Katarungang Pambarangay / Lupon blotter | Out of scope. Neighbor disputes stay with the Lupon (RA 7160). Posted on `/charter` and Help. |
| Barangay clearance / indigency | Not issued. |
| 911 / PNP / BFP | Explicitly refused on the home banner. |
| SMS blotter like many e-barangay theses | Consent for SMS is stored. **No SMS is sent.** |
| Walk-in auto-file from an official account | Officials cannot `concern.submit`. Walk-in = hall creates a **resident** account on a terminal. |
| Full COA production treasury | Modeled on GAM for LGUs (prepare → certify → Punong Barangay approve). Demo Admin still has wide rights in code. |

Public charter: `/charter` (RA 11032-style service map). Privacy: `/privacy`
(RA 10173). Tracking without PII photos: `/track`, `/transparency`.

References used for this review:

- RA 11032 / ARTA Citizen’s Charter, PACD, 3–7–20 clocks for **frontline**
  steps ([1](https://www.respicio.ph/commentaries/applicability-of-ranbsp11032-to-barangay-and-lgu-complaints))
- RA 7160 barangay structure; KP vs service complaints
- COA GAM / LCE approval of disbursement vouchers
  ([3](https://www.coa.gov.ph/wp-content/uploads/ABC-Help/Various_Transaction/48circ92-382g.htm))
- ISO/IEC 25010 as the usual thesis evaluation instrument in PH IT programs
  ([4](https://ijece.virtualrealia.org/wp-content/uploads/2026/06/Development-and-Validation-of-the-Barangay-Governance-Information-System-BAGIS-for-Local-Administrative-Operations.pdf))

---

## 2. The five panelists — likely questions and the honest answer

### Chair (scope and contribution)

**“This is huge. What is the thesis, not the feature list?”**

Core contribution: **one auditable case record** from submit → close, with
priority, routing, proof photos, action dates, and a budget gate so work
cannot be marked done without money when money is required.

Extended modules (treasury, SLA, privacy/DSR, push, reports) are **depth**,
not the claim. Demo one case end-to-end. Have treasury + closure as
“if asked.”

**“Did you evaluate with ISO 25010 and real barangay users?”**

The code is built to be evaluable (roles, bilingual UI, error messages).
This repository does **not** contain filled ISO 25010 questionnaires or a
signed MOA with a barangay. If the manuscript has those, bring them. If not,
say so: expert validation is a remaining academic requirement, not a hidden
module.

### Technical panelist (architecture, security)

**Stack.** Next.js 15 App Router, TypeScript, Prisma/PostgreSQL, Zod on
client and server, custom JWT in an HttpOnly cookie, bcrypt, Vitest.

**Auth.** Middleware checks **live DB state** (active flag, `tokenVersion`,
revoked tokens), not only JWT claims. Portals are role-gated
(`PORTAL_GUARDS` + `SHARED_PORTAL_ROUTES` so the Captain can open a case
sheet without seeing the office queue).

**API.** ~92 `route.ts` handlers under `/api/v1`. Pattern: parse →
`requirePermission` → service re-checks office/ownership/state.

**Prior live audits** (2026-10-14) exercised SQL injection, XSS, CSRF, IDOR,
JWT forgery, path traversal, oversized uploads, and a concurrent double
approval. Those held. This session could not re-run them (Prisma engines /
DB unreachable here).

**Residual technical risks to say out loud:**

1. **Admin is a superuser** in `ROLE_PERMISSIONS` (almost every key except
   resident submit). In a real hall, the administrator must not both certify
   and approve money. Demo with **separate** treasurer and captain accounts.
2. **No SMS gateway** despite an SMS consent purpose.
3. **Custom JWT** instead of a battle-tested IdP. Defensible for a capstone;
   name session rotation, HttpOnly, `tokenVersion`, revoke-on-logout.
4. **Android APK** is a Capacitor WebView of the hosted URL, not an offline
   native app.

### Domain panelist (barangay / public admin)

**Roles vs a real hall**

| Role | Lands on | Can | Cannot |
|---|---|---|---|
| Resident | `/resident` | Submit, track own, feedback, consent, ID | Other people’s cases, status, money |
| Official | `/official` | Office queue, field check, assess, crew, status + proof, resolve | Submit as resident, approve vouchers, close |
| Crew | `/crew` | Own jobs, short note | Case sheet, start work, file concern |
| Treasurer | `/treasury` | Fund, prepare, certify | Approve release, `/captain/*` |
| Captain | `/captain` | Approve money, verify, close, SLA | Assess, assign crew, certify funds |
| Admin | `/admin` | Users, offices, categories, routing, priority, privacy, SLA | Should not replace Captain in production |

Money path matches the usual LGU story: treasurer certifies availability,
Punong Barangay (AAO) approves. A case in `AWAITING_BUDGET` cannot skip an
approved sufficient earmark.

**RA 11032.** Intake, case number, tracking, and this charter are the
frontline pieces. Inspection/repair time is **SLA**, not the 3–7–20 permit
clock — say that before they do.

**Walk-in / PACD.** Operational, not a proxy-submit API. Honest and
correct: staff must not file under their own official account.

### Methodology panelist (ISO 25010 / SDLC)

Map the product, do not invent scores:

| ISO 25010 characteristic | Evidence in the product | Gap |
|---|---|---|
| Functional suitability | 9 process steps, gates, RBAC matrix, validations | No signed UAT from a barangay |
| Performance efficiency | Pagination, report caps, streamed CSV | No published load test |
| Compatibility | Web + Capacitor Android WebView | Offline mode is draft-only |
| Usability | EN/FIL, DeskGuide, empty states, Help, Charter | First-login work is now above the guide |
| Reliability | Hash-chained audit, cron jobs, email retry | Needs a live host with cron secret |
| Security | RBAC, rate limits, upload quota (Manila day), PII masking | Admin SoD; no pentest report in-repo |
| Maintainability | Pure domain modules + unit tests | Breadth is a bus-factor risk |
| Portability | Vercel + Postgres | Prisma generate needs engines |

### Industry / external panelist (ops, sustainability)

**Who runs this after the student leaves?** Admin desk + README + seed.
Need: hosting, `DATABASE_URL`, encryption key, `CRON_SECRET`, SMTP, backup.

**Citizen’s Charter** is now a page they can screenshot. Keep it true; if a
service is added, update `/charter` the same day.

---

## 3. Frontend / backend snapshot (this pass)

**Fixed because a panelist would have caught them**

- Home said **5** status steps; the hall flow is **9** steps
  (`CHECK` … `CLOSE`). Copy now says 9.
- Home listed only resident / official / admin. All **six** roles are on
  the landing page.
- “Peace & order” read like a KP blotter. Copy now points noise/safety
  hazards to this system and disputes to the Lupon.
- Crew Help still demanded a **proof photo**; the crew form is a 5–500
  character note. Copy matches the form.
- Register offered **SMS updates** with no gateway. Consent text now says
  consent-only, no text today.
- Public **Citizen’s Charter** (`/charter`) for RA 11032 hygiene.

**Already strong (do not re-litigate in the room unless asked)**

- Proof photo + action date on status changes; dates cannot be future or
  older than the case floor (HTML min/max **and** client + server).
- Assessment plan cannot be moved into the past; future plans are allowed.
- Fiscal year cannot open in the past.
- Empty / too-short / too-long notes fail in the form, not only in Zod.
- After login, queues sit **above** how-to cards.

**Still not live-proven in this sandbox:** Prisma engines / `.env` / DB, so
no role login in this session. Previous audits did live HTTP as seven
sessions. Rehearse that battery before the defense hour.

---

## 4. Demo script (one case, ~12 minutes)

Password for seeded staff: `BarangayResolve123!` (emails `*@barangayresolve.dev`).

1. Guest: home banner (not 911) → `/charter` (not KP) → register **or**
   `resident@…` → submit with photo.
2. Admin: validation / identity if the gate is on.
3. Official: field check → assess (workers, duration, equipment) → crew.
4. Treasurer: fund / earmark → certify. Show that **approve** is missing.
5. Captain: approve voucher → later verify + close. Show that **assess**
   is missing on the sheet.
6. Crew: only own job, short note.
7. Resident: same case number, then rating after resolve.
8. Adversarial one-liners: treasurer opens `/captain/approvals` (denied);
   past journal date (rejected); empty crew note (rejected).

Do **not** try to demo every admin screen.

---

## 5. What to put in the manuscript vs the slides

**Slides:** problem (Facebook/untracked reports), one diagram (9 steps),
RBAC table, one legal slide (11032 / 10173 / GAM), ISO 25010 plan, limitations.

**Manuscript:** related systems (BAGIS, e-barangay blotter+SMS+certificates),
why this thesis is **workflow + money gate + proof**, not another resident
registry.

**Limitations slide (required):** no KP, no SMS send, no certificates,
walk-in is operational, Admin SoD, evaluation with barangay users if not
yet done.

---

## 6. Ready or not?

| Question | Answer |
|---|---|
| Can five panelists be shown a coherent system? | **Yes**, if the demo is one case and the charter is on screen. |
| Is every module production-hardened? | **No.** Treat extended modules as working prototypes with tests. |
| Will a domain expert accept the legal story? | **Yes**, if KP/911/certificates are refused up front. |
| Will a technical expert accept security? | **Yes**, if prior audit findings are cited and Admin SoD is admitted. |
| Will methodology accept ISO 25010? | **Only** if the paper has instruments and respondents, or an honest “future work.” |

**Go to defense with this product. Do not go to defense claiming it is the
entire barangay.**
