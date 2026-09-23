# Bela-HRMS

Human resource management for **Bela Nepal Industries Private Limited**, replacing the
Nimble.Ananta HRIS recovered in `../Nimble.Ananta.Host/_revive/`.

Version 1.0. Thirty-one screens are built across six modules — Employees,
**Attendance**, **Leave**, Organisation, Administration and Documentation. The rest of
the HRMS is declared in the menu with its route, permission and scope already fixed, so
each one is filled in without the navigation moving under anybody's feet.

```bash
pnpm install
./bela db fresh --full   # create the database, migrate, seed two fiscal years
./bela up                # check everything, then start
```

`./bela up` is the only command you need day to day. It verifies the database is
reachable and UTF-8, applies any pending migrations, finds a free port if 3000 is
taken, and prints the logins. If something is wrong, `./bela doctor` says what and
gives you the command that fixes it.

<http://localhost:3000> — sign in as any of:

| Email | Password | Role | Sees |
|---|---|---|---|
| `admin@bela.example.np` | `Admin@123` | Administrator | Everything |
| `sunita.maharjan@bela.example.np` | `Hr@12345` | HR Manager | HR, all attendance and leave, org setup |
| `gopal.neupane@bela.example.np` | `Super@123` | Supervisor | Own team, approvals |
| `hari.bahadur@bela.example.np` | `Staff@123` | Employee | Own attendance and leave |

Sign in as each in turn — the navigation is different every time. That is the
permission system resolving, not four hard-coded menus.

### Requires

PostgreSQL 14+ and Node 20.9+. Override `DATABASE_URL` in `.env`.

**The database must be UTF-8.** A Windows PostgreSQL install defaults its templates to
WIN1252, which cannot store Devanagari and fails on the first Nepali-script insert:

```sql
CREATE DATABASE bela_hrms ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0;
```

---

## Modules

| Module | Status | Screens |
|---|---|---|
| **Employees** | 2 of 7 built | Employees, Reporting Lines · *documents, confirmations, transfers, separations, recruitment planned* |
| **Attendance** | 9 of 10 built | My Attendance, Daily Register, Monthly Sheet, My Requests, Approvals, Shift Master, Shift Assignment, Devices, Reports (overview, muster roll, late & early exit, absenteeism with Bradford factor, overtime, exceptions, departments — CSV export and print) · *overtime claims planned* |
| **Leave** | 8 of 10 built | My Leave, Approvals, Register, Calendar, Reports (overview, balances with lapse risk, by leave type, leave history, approval turnaround, departments — CSV export and print), Balances, Types, Policy · *encashment, lapse planned* |
| **Payroll** | planned | Salary heads and structure, monthly run, payslips, TDS, SSF/PF, bank advice |
| **Appraisal** | planned | KRA/KPI, rating scales, cycles, self appraisal, reviews, results |
| **Training** | planned | Programmes, calendar, nominations, session attendance, effectiveness |
| **Travel & TADA** | planned | Requests, approvals, settlement, TADA rules, locations |
| **Expense Claims** | planned | Claims, approvals, categories and limits, staff advances |
| **Procurement** | planned | Purchase requests, quotations, orders, goods receipt, vendors |
| **Inventory** | planned | Items, groups, stores, requests, issue and return, stock ledger |
| **Fixed Assets** | planned | Register, groups, allocation, maintenance, depreciation, disposal |
| **Organisation** | 14 of 14 built | Company Profile, Branches, Departments & sections, Designations, Grades, Employment Types, Divisions, Business Units, Sub Business Units, Functional Categories, Projects, Locations, Fiscal Years, Holidays — every master editable (add, edit, deactivate, reactivate, delete when unreferenced), audited field by field |
| **Administration** | 4 of 5 built | Users, Roles, Audit Trail, Appearance · *notifications planned* |
| **Documentation** | 7 of 7 built | Getting Started, User Manual, FAQ, Architecture, Data Model, Workflows, Roadmap |

A planned screen is a real route. It renders what it will do, which permission guards
it, and where it sits in its module. Everything is declared in
[`src/modules/registry.ts`](src/modules/registry.ts) — that file is the product spec.

**To build the next one:** change `planned(...)` to `ready(...)` in the registry and add
the page at the href already declared. Nothing else moves.

---

## Navigation

Fourteen modules and 88 screens do not fit in a flat list, so the sidebar is a
collapsible tree:

- **The module holding the current route opens itself**, once. Opening and closing
  after that is yours: a module you collapse stays collapsed, including the one you are
  standing in.

  That last clause is the whole of a bug worth remembering. The auto-open effect
  originally depended on the expanded map it wrote to, so collapsing the active module
  wrote `false` and the effect immediately wrote `true` back — the menu appeared to
  ignore the click. A ref recording which module has already been auto-opened
  ([`src/components/app-nav.tsx`](src/components/app-nav.tsx)) makes it open once per
  arrival instead of once per render.
- **Sections inside a module** — Daily / Requests / Setup / Reports — grouped by
  label rather than by declaration order, so a module never shows the same heading
  twice.
- **Open state persists** per browser, and navigating into a collapsed module opens it.
- **Badges** show approvals waiting *on you*, scoped exactly like the queue itself.
- **Search** (`/` to focus) filters every screen by name, module or section.
- **Rail mode** collapses the sidebar to icons — worth it on the monthly attendance
  matrix, which is 31 columns wide. Clicking a module icon expands both.
- **Breadcrumb** above each page title: Module › Section › Screen.
- Planned screens are dimmed and marked `soon`, so what is built is obvious at a glance.

Preferences are read through `useSyncExternalStore`
([`src/lib/persisted.ts`](src/lib/persisted.ts)) rather than hydrated with a
`setState` in an effect — the server snapshot is `null`, so there is no hydration
mismatch and no cascading render.

---

## Attendance

The module the legacy system spent 39 controllers and 546 actions on, rebuilt around
four tables.

| | |
|---|---|
| `shifts` | The pattern: in, out, unpaid break, grace windows, what counts as a full or half day, when overtime starts, whether it crosses midnight |
| `shift_assignments` | Which shift somebody is on, **from when**. Moving them closes the current row rather than editing it, so attendance already calculated stays explicable |
| `attendance_days` | **Exactly one row per employee per date** — including weekly offs, holidays and leave |
| `attendance_requests` | A claim that a row is wrong, on the shared approval engine |

That third point is the important one. The legacy schema only wrote a row when
somebody punched, so *absent* and *no record yet* were indistinguishable and every
report had to guess which it was looking at.

**The calculation** lives in [`src/lib/attendance/calc.ts`](src/lib/attendance/calc.ts)
with no database import, so the seed generator and the running app compute attendance
with the same code — if they ever disagreed, the demo would stop being evidence.
Worked minutes are net of the break; lateness starts after the grace window; a night
shift's out-punch is on the next calendar day; overtime accrues past the shift end plus
its threshold; and a punch on a weekly off or holiday is all overtime, because there is
no shift to be late for.

**Nepal works a six-day week** — only Saturday is a weekly off, and it is excluded from
day counting along with public holidays.

```bash
pnpm check:attendance   # submit → route → approve → assert the day recalculated
```

---

## Leave

Nine leave types with real policy, and three columns on each that decide what the
rest of the product does with a day of it:

| | |
|---|---|
| `nature` | What the day **is** — `paid`, `unpaid`, `official_work`, `transit`, `absent`, `substitute`, `holiday`. Attendance turns this into a daily status and nothing else may. |
| `paidPercent` | What payroll pays. 100 for ordinary leave, 50 for study leave, 0 for leave without pay — one number, one meaning. |
| `lapseType` | When unused entitlement disappears: never, monthly, at year end, or at the end of a service period. |

The legacy system spread the same three facts across a boolean called `IsPaid`, a
`LeaveTypeID` some reports switched on, and a salary-head relation table — and they
disagreed. Unpaid leave was paid in one report and deducted in another, and settling
which was right meant reading the SQL.

**Field work is the case that proves it.** It is a leave type, so it is requested and
approved like any other, but its nature is `official_work`: attendance writes
`field_work`, which counts as a **present** day, and it deducts no balance. A site
engineer out for three days no longer fails an attendance target for working — which
is exactly what happened when the old system booked field work as leave.

Alongside the three: entitlement per employment type (`leave_type_entitlements` — a
permanent employee gets 18 days of home leave, a contract employee 9, a probationer
none), per-salary-head pay overrides (`leave_salary_effects` — study leave pays basic
in full and allowances at half), maturity interference (`leave_maturity_effects`), and
substitute credits for a weekly off that was worked.

**Approval is sized from the request.** A leave type caps what each level may sign off —
five days for a supervisor, fifteen for a manager. `levelsRequired()` is a pure function
of the policy and the day count, so a twenty-day request is routed to the level that can
actually approve it at submission rather than being forwarded by hand.

Balances remain transactional: a submission **reserves the days before it checks them**,
under a row lock, so a second concurrent submission blocks rather than reading a stale
balance. Approval moves days from `pending` to `used`, rejection releases them,
withdrawal returns them — each in the same transaction as the status change.

```bash
pnpm check:leave    # 23 assertions: policy → routing → attendance status → payroll lines
```

---

## Leave, attendance and payroll

One approved request changes three modules, and no module reads another's tables to
make it happen.

```
Leave approves            commits its own transaction, publishes leave.request.approved
  └─ event carries        dates · nature · paidPercent · holiday and weekly-off policy
       ├─ Attendance      expands the span against the calendar, writes the daily status
       └─ Payroll         payableDays() asks both ports, returns days it can multiply
```

Attendance decides which dates inside the span it marks — leave publishes the span and
the policy, not a day list, because how a day is modelled is attendance's business.
Payroll's `payableDays()` assembles a month from the attendance and leave ports and sets
`incomplete` when either was unavailable: a run that reads an attendance outage as
"nobody came to work" pays nobody, and one that reads a leave outage as "nobody took
leave" overpays everybody. Neither is acceptable, so the answer says when it cannot be
trusted.

---

## Module independence

The requirement is operational, not aesthetic: **a fault in one module must not stop
another module working.** Four mechanisms deliver it, and
`pnpm check:isolation` proves each one against the real database.

| | |
|---|---|
| **Contracts, not imports** | [`src/kernel/ports.ts`](src/kernel/ports.ts) declares what each module offers — types only, no runtime imports, so a contract cannot drag another module's code or schema in. Ports return plain data, never Drizzle rows, which is what makes a table change private. |
| **Nullable resolution** | `resolve("attendance")` returns `null` when that module is missing, failed or switched off; `callPort()` turns a throw into a fallback. The type system forces every call site to answer *what do I do without it*. |
| **Events, not calls, for writes** | A module publishes into `domain_events` inside its own transaction and returns. Others react afterwards in their own. A subscriber failure is recorded against the event and retried — it never rolls back the publisher. |
| **Enforcement** | ESLint refuses a cross-module import, naming the rule and the alternative. A boundary that lives only in a README lasts until the first deadline. |

The dependency that mattered ran the wrong way: attendance imported `lib/leave` for
approval routing and joined `leave_requests` to colour its register. Both are gone.
Approval moved to [`src/kernel/approvals.ts`](src/kernel/approvals.ts) — it was never
leave-specific, and travel, expense and procurement attach to the same ledger. The
register now reads leave through the port, and renders without leave colouring if leave
is unavailable, because a missing colour is cosmetic and a sheet that will not load is
not.

**What it looks like in practice.** Approving leave commits the approval and publishes
`leave.request.approved`. Attendance subscribes, expands the span against the calendar,
and marks the days — end to end, in the running app:

```
events:          leave.request.approved  status done  handlers [attendance.mark-approved-leave@1]
request:         LV-2083-0001  approved
attendance days: 16, 17, 18, 20 Sept → on_leave      (19 Sept, a Saturday, correctly skipped)
```

Leave does not know which days attendance marks; it publishes the span and attendance
asks the calendar. If attendance is down the approval still commits and the event waits.

Two calls are deliberately *not* nullable. `resolveChain` requires the people module,
because a request routed to nobody because of a boot problem is indistinguishable from
one routed to nobody because the employee has no supervisor — the first is an outage,
the second is data entry, and quietly merging them is how the legacy system lost
approvals. **Administration › Modules** shows what is installed, what it depends on,
what is degraded, and the queue depth; each module can be switched off per organisation
without a deployment.

---

## Organisation structure

The legacy Organization Structure area defined a dozen near-identical code/name/parent
tables — Division, Business Unit, Sub Business Unit, Functional Category, Section,
Project, Location, Sub Location — each with its own controller, screen and subtly
different validation. A dozen tables that differ only in what they are called is one
table with a discriminator, and six screens that differ only in their labels are one
screen configured by kind.

`org_units` carries all six generic kinds; `branches` and `departments` keep their own
tables because `employees` references them and both are already self-referencing trees —
a *section* is a department with a parent, a *sub-location* is a branch with a parent.

The rules the old system did not have are enforced in
[`src/modules/org/structure.ts`](src/modules/org/structure.ts) and proven by
`pnpm check:org`: a business unit must sit under a division, a division cannot have a
parent, a unit cannot be its own parent or be moved inside its own child, and a unit
with active children cannot be deactivated. The legacy schema stored `UnderGroup = 0`
for a root with no foreign key, so a business unit could end up under a project and the
structure report recursed until it timed out.

Alongside it: `position_levels` and `level_grades`, `job_titles` (with the branch-head /
department-head flag that makes somebody an approver), `services` and `service_groups`,
and `remuneration_groups` — the attendance and overtime policy per class of staff, which
attendance receives as a resolved policy object rather than a row.

---

## Working calendar

`weekly_offs` holds the pattern per branch and per date range; `holiday_groups` with
employee and branch relations scope a holiday to who actually observes it. Resolution
order is *scoped holiday > branch weekly off > organisation weekly off > working*, and it
lives in one module that attendance, leave and payroll all read through, because they
must never disagree about what a working day is. Hard-coding Saturday would mean
re-deriving every attendance figure the day a branch moves to a different pattern.

---

## The three decisions that matter

Each is a direct response to something that actually broke in the system this replaces.
The diagnosis is in `../Nimble.Ananta.Host/_revive/README.md`.

### 1. Navigation and permissions are code, not rows

The database stores only *grants* — which role holds which permission string. The
catalogue and the tree ship with the build.

The legacy system kept its whole menu tree in the database. The shipped code moved on;
the rows did not. A menu item ended up pointing at a parent that no longer existed, the
tree could not be walked, and **every permission check in the product started returning
"denied"** with no error explaining why. That system runs today and still cannot show a
single business screen.

A grant for a permission this build no longer defines is ignored at check time rather
than fatal, and `/admin/roles` lists any such rows so they can be cleaned up.

### 2. One approval engine, not one per module

`approval_steps` is generic: `(entityType, entityId, level, approver, decision)`.
Leave and attendance both run on it; travel, expense and procurement attach without new
tables. The queues stay separate because they filter on `entityType`.

The legacy system implemented "levels of approval" separately in leave, travel order,
expense claim, staff advance, asset request and appraisal — six copies of one state
machine, each with its own bugs.

The whole chain is written at submission, resolved by walking the supervisor tree, so
the UI says *awaiting: Gopal Neupane* rather than just *pending*.

### 3. Bikram Sambat is a type, not a display format

[`src/lib/bs/`](src/lib/bs) converts between BS and Gregorian. **The calendar table was
extracted from the legacy application's own embedded resource**
(`Nimble.Core.Resources.NepaliCalendarData.xml`, BS 2000–2100), so every date this
system converts agrees with every date the old one ever stored. BS month lengths are
astronomically determined and published yearly — they cannot be computed, only looked up.

Gregorian is stored, BS derived. Attendance and leave periods are **BS months**, not
Gregorian ones: a Nepali payroll month runs Shrawan 1 to Shrawan 32, and slicing on
Gregorian boundaries would split every month across two payslips.

---

## Stack

Next.js 16 (App Router, Server Components, Server Actions) · React 19 · TypeScript 5 ·
Drizzle ORM · PostgreSQL · Better Auth · Zod 4 · Tailwind 4 · lucide-react.

No REST/GraphQL layer, no component library, no client state manager. Server Components
read the database directly and Server Actions write to it, so there is no client cache
to invalidate and no DTO to keep aligned.

Authorization is one guard, `requirePermission`, used by both pages and actions. On a
page it raises Next's `forbidden()` for a real **403**; in an action it throws, because
a mutation must abort rather than half-apply.

## Layout

```
src/
  app/(auth)/login/          sign-in
  app/(app)/                 authenticated shell — sidebar comes from the registry
    dashboard/
    hr/employees/            list, detail, new, edit
    hr/reporting-lines/
    attendance/my|register|monthly|requests|approvals|shifts|roster
    leave/my|approvals|register|calendar|balances|types
    setup/                   branches, departments, designations, fiscal years, holidays
    admin/                   users, roles, audit, appearance
    docs/                    manual, faq, architecture, data model, workflows, roadmap
    [module]/[[...rest]]/    every planned screen
  kernel/                    ports · registry · events · approvals · boot
  modules/<id>/module.ts     each module's port + event subscriptions
  components/charts.tsx      donut · stacked bar · waffle, as themed SVG
  components/clock.tsx       NPT, hh:mm:ss, client-only by necessity
  modules/leave/policy.ts    entitlement · routing limits · pay effects
  modules/payroll/module.ts  payableDays(), the worked example of port consumption
  db/schema/                 auth · core · org · org-structure · hr · approvals
                             calendar · leave · leave-policy · attendance · kernel
  db/seed.ts                 demo dataset (idempotent)
  lib/attendance/            calc.ts is pure; index.ts is the database side
  lib/leave.ts               leave domain service (transactional)
  lib/bs/                    Bikram Sambat + the extracted calendar table
  lib/session.ts             getViewer / requirePermission
  lib/appearance.ts          theme tokens + the pre-paint bootstrap script
  lib/persisted.ts           localStorage through useSyncExternalStore
  lib/branding.ts            product name, company, version — stated once
  components/brand.tsx       the logo, at every size it is used
  modules/registry.ts        modules, navigation, permissions, roadmap
public/brand/bela-logo.png   company logo (also src/app/icon.png, the favicon)
```

## Commands

| | |
|---|---|
| `./bela up` | check, migrate, resolve the port, start |
| `./bela doctor` | diagnose the environment; every failure names its fix |
| `./bela db fresh --full` | drop, create with UTF-8, migrate, seed both years |
| `./bela db status` | what is in the database right now |
| `./bela bench --build` | measure the hot pages at 459 employees / 335 K rows |
| `./bela check` | typecheck, lint, and every verification suite |
| `./bela stop` · `./bela reset` | stop a stray dev server · reinstall from scratch |
| `pnpm dev` · `pnpm build` | run · production build |
| `pnpm db:migrate` | apply migrations |
| `pnpm db:generate` | generate a migration from the schema |
| `pnpm db:seed` · `pnpm db:reset` | seed (idempotent) · wipe the tenant and re-seed |
| `pnpm db:seed:history` | a complete closed previous fiscal year |
| `pnpm admin:unlock <email>` | break-glass: grant system administrator |
| `pnpm check:attendance` | attendance workflow smoke check |
| `pnpm check:isolation` | proves a failing module cannot take another down |
| `pnpm check:org` | proves the structure hierarchy rules |
| `pnpm check:leave` | proves leave policy reaches attendance and payroll |
| `pnpm check:people` | proves expiry, probation, upload and reporting-loop rules |
| `pnpm typecheck` · `pnpm lint` | |

## Personnel records

Four things the recovered database captured and never acted on.

**The record itself.** `EmployeeInfo` had **263 columns over 459 people**, and the screen
over it was a form with every one of them — a data-entry surface, not a record anybody
reads. The profile here is organised around the questions somebody opens it to answer,
with anything carrying a deadline surfaced at the top. A photograph is resized in the
browser before upload: a 1.04 MB test image arrived as **6.7 KB**, measured, which is why
there is no native image library on the server.

**Documents.** `EmpDocumentInfo` held a thousand rows with issue and expiry dates on them,
and its view joined an `ApprovalStatus` to the same action table the leave workflow used —
so a personnel document was already meant to be a *governed* record rather than a file in a
folder. What was missing was any screen that asked "what expires next month". That question
is now the register, with a status of pending / verified / rejected behind it. Editing a
verified document resets it to pending, because a tick that says "somebody checked this
scan" stops meaning anything the moment the scan changes.

**Reporting lines,** editable in place. The chain routes leave approvals, so a loop in it is
an approval that can never be routed. The old tree screen dropped looped people silently —
neither was a root, and their parent was unreachable — so nobody could find where they had
gone. Here the supervisor list excludes anyone already below you, the server re-checks the
whole chain before writing, and any loop already in the data is listed rather than hidden.

**Confirmations.** Probation was `ProbationDate` → `DateOfPermanent`, two columns with
nothing reading them on a schedule, so people stayed "on probation" for years. The queue
sorts overdue first and puts **"no end date set" second, above "due soon"** — that is the
case that silently never surfaces, and it is the one the old system lost people in. The
decision writes to `probation_reviews` and to the employee row in one transaction, so an
extension leaves a trail instead of overwriting the previous date.

**Files live in Postgres** as `bytea`, content-addressed by sha256. On a single VPS that
means one backup covers the database and the documents together and a restore cannot leave
rows pointing at files that are gone. Uploads are typed by sniffing their bytes, never by
the browser's claim — HTML renamed to `.png` is refused — and `/api/files/[id]` decides
access from what the file is *used for*, so a document hidden from an employee cannot be
fetched by them either.

```bash
pnpm check:people   # 31 assertions: expiry and probation boundaries, uploads, loops, tenancy
```

A second one, caught by signing in as two people on the same browser: the file route
originally sent `Cache-Control: private, max-age=3600`. An HTTP cache is keyed by URL
alone, so after an administrator opened a confidential document, the next person to sign in
on that machine could read it straight out of the browser cache — an ordinary fetch of the
same URL returned **200 instead of 404**. It now sends `private, no-cache, must-revalidate`
with `Vary: Cookie`, so every reuse is re-authorised; the ETag makes that a 0-byte 304.

One bug this caught, worth recording: `daysBetween` is **inclusive** — the same day is 1,
not 0 — because that is what leave counting needs. Reused for a countdown it made a
document that expired yesterday read as *zero days remaining*, so the reminder would never
have fired. The fix was a separate, honestly named `daysUntil`, not a change to the one the
leave engine depends on.

---

## Scale

The recovered production database says what this has to survive: **459 employees,
52 branches, 19 departments, and 1.74 M attendance rows over ten years** — 2.1 M
rows and 576 MB in total. The demo database has 24 employees and 9 K attendance
rows, three orders of magnitude off, which is exactly the gap where a page that
feels instant in development becomes unusable in production.

`./bela bench --build` generates a production-shaped dataset (459 employees,
335 K attendance days, two years) in a scratch database and measures the queries
the hot pages actually issue.

**What it found.** Every query was fast — the slowest, the whole-organisation
month read, was 61 ms. The pages were not:

| Page | Before | After |
|---|---|---|
| `/attendance/monthly` | 1,273 ms · **7.2 MB** | **187 ms · 588 KB** |
| `/attendance/register` | 326 ms · 1.5 MB | **116 ms · 268 KB** |

The monthly sheet renders one cell per employee per day: 459 × 31 = 14,229 cells,
and it grew linearly — 15 MB at a thousand staff. The queries were never the
problem, the payload was. Both pages are now paginated by employee, and the
attendance read is restricted to the employees on the page, turning a
14,000-row scan into a few hundred.

**The tiles above both tables stay organisation-wide**, computed as a separate
aggregate in SQL. Summing the visible page would make "absent days" change as you
page through — a report that describes nothing, and the most common way
pagination quietly corrupts a total. Verified against the database: the rendered
tiles read absent 2, late 440, overtime 8.4 h; SQL over the same Bikram Sambat
month returns 2, 440, and 505 minutes.

A note on measuring: in development mode the same page took **33 seconds**. That
is a dev-server artefact, not the product — React Server Components render far
slower unoptimised. The numbers above are from `pnpm build && pnpm start`, which
is the only mode worth quoting.

---

## Development automation

Four scripts under `scripts/dev/`, driven by a `./bela` dispatcher. They exist
because the same four questions came up every time somebody new cloned this:
*is the database up, is the schema current, why is the port taken, and what am I
looking at.*

Written in **Node rather than shell**, deliberately. The team runs Git Bash on
Windows, zsh on macOS and bash on the VPS, and the tools a shell version would
need — `lsof`, `psql`, `pg_isready` — are missing or subtly different on at
least one of them. Node and `pg` are already hard requirements and behave
identically everywhere.

| | |
|---|---|
| [`doctor.mjs`](scripts/dev/doctor.mjs) | Toolchain, `.env`, connection, encoding, migration drift, ports, seeded data. Every failure prints the command that fixes it — a diagnostic that reports a problem without a remedy has only moved the guessing later |
| [`db.mjs`](scripts/dev/db.mjs) | `fresh` drops, recreates with `ENCODING 'UTF8' TEMPLATE template0`, migrates and seeds. Terminates open sessions first, because in development something is always connected and `DROP DATABASE` refuses |
| [`up.mjs`](scripts/dev/up.mjs) | The orchestrator: database → encoding → migrations → data → port → start |
| [`lib.mjs`](scripts/dev/lib.mjs) | Shared plumbing. Nothing here writes; anything destructive lives behind a confirmation in `db.mjs` |

Three things they get right that are easy to get wrong, each found by testing
rather than by reasoning:

**The port probe binds dual-stack.** Next binds `::`; a probe bound to
`127.0.0.1` reports a port held by our own dev server as free, and Next then dies
with `EADDRINUSE` a second later. Omitting the host makes the probe bind exactly
the way the server will.

**A moved port moves the auth origin with it.** Starting on 3001 while
`BETTER_AUTH_URL` still says 3000 produces an app that loads, accepts a password,
and silently fails to sign in — the cookie is scoped to the wrong origin and the
browser drops it. `up.mjs` overrides it for the run.

**`pnpm up` and `pnpm doctor` are pnpm builtins.** `pnpm up` is an alias for
`pnpm update`; a script by that name would mean typing "start the app" and
getting every dependency upgraded. The scripts are `dev:up` and `dev:doctor`, and
`./bela` keeps the short names.

The database commands also honour `DATABASE_URL` from the real environment over
`.env`, so a one-off run against a scratch database is
`DATABASE_URL=…/scratch ./bela db fresh` rather than editing a file and
remembering to change it back.

---

## Demonstration data

Two seeds, and the second is the interesting one.

`pnpm db:seed` builds the **current** year: 24 staff, the organisation structure,
leave policy, and seventy-five days of attendance with a handful of open
requests. Enough to see the screens.

`pnpm db:seed:history` builds a **complete closed previous fiscal year**, which
exercises the lifecycle a live demo never reaches:

```
fiscal year              2082/83 - 2025-07-16 to 2026-07-16
holidays                 26 in 2082/83
opening balances         144 rows, carrying prior-year accumulation
leave requests           101 - 84 approved, 14 rejected, 3 withdrawn
balances reconciled      64 employee/type pairs
attendance days          7,546 rows across 24 staff
attendance corrections   24 raised and decided
year-end close           2,019 days carried forward, 276 encashed, 398 lapsed
period locks             36 module-months, every day stamped
```

Everything is generated by the same pure functions the application runs -
`computeDay` for attendance, the published BS calendar for dates - so the numbers
survive being added up. The reconciliation is asserted rather than assumed: leave
`used`, recomputed from approved requests, matches the stored balance on all 64
pairs. That is the invariant the product claims and the legacy database did not
hold.

It also produces the states you cannot otherwise see. **All three year-end paths
fire** - carry-forward, encashment of the excess over the accumulation cap, and
lapse of yearly types - and the closed year refuses corrections, because every
day in it is stamped locked.

Both seeds are idempotent, and the history seed never touches the current year.

---

## Deployment

Private VPS, three containers, no orchestrator. The runbook is
**[DEPLOYMENT.md](DEPLOYMENT.md)**.

```bash
cp .env.example .env      # fill in; openssl rand -base64 48 for the secret
docker compose up -d --build
```

| | |
|---|---|
| [`Dockerfile`](Dockerfile) | Four stages to a ~180 MB runtime image: no toolchain, no devDependencies, non-root, healthchecked |
| [`docker-compose.yml`](docker-compose.yml) | Postgres, app, Caddy. Migrations run as a one-shot service that must *complete* before the app starts |
| [`deploy/Caddyfile`](deploy/Caddyfile) | Automatic TLS, health-checked upstream |
| [`deploy/backup.sh`](deploy/backup.sh) | Nightly dump that **verifies the archive** before applying retention |
| [`deploy/restore.sh`](deploy/restore.sh) | Restore with the app stopped and migrations re-run afterwards |
| `/api/health` | Queries the database. A process that is listening but cannot reach Postgres is not healthy |

Postgres publishes no port - it is reachable only on the compose network.
`next.config.ts` emits `output: "standalone"` and sets the security headers at the
application edge as well as in the proxy, so whichever layer is bypassed the other
still applies them. Migrations run through `drizzle-orm`'s own migrator
([`scripts/migrate.mjs`](scripts/migrate.mjs)) rather than `drizzle-kit`, so the
image that applies the schema is the image that serves it and there is no second
dependency tree in production.

Three things that silently break a deploy, all called out in the runbook: the
`DATABASE_URL` host is `postgres`, not `localhost`; `APP_DOMAIN` carries no scheme
and no trailing slash; and the DNS A record must resolve *before* the first `up`,
because Let's Encrypt rate-limits failed requests to five a week.

---

## Migrating real data

`../Nimble.Ananta.Host/_revive/out/model.json` describes all 984 legacy tables and
`routes.csv` every action with the permission it required. Per module: read the legacy
tables, map them onto the schema here, convert BS strings with `src/lib/bs` (same
calendar table as the old system), then reconcile derived figures — recompute leave
`used` from approved requests and attendance totals from punches before trusting either
side.

The 453 stored procedures in `_revive/out/stored_procedures_required.json` are not
recoverable from the legacy binaries. Where one encodes a rule you still need, it has to
be rewritten from the business requirement.

---

© 2026 Bela Nepal Industries Private Limited. Bela-HRMS v1.0.
