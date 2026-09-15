import { requirePermission } from "@/lib/session";
import { PageHeader, Badge } from "@/components/ui";
import { Arrow, ArrowDefs, Callout, DefTable, DocSection, Figure, Pill, Prose, Steps } from "../parts";

export const metadata = { title: "Module architecture" };

/** Delivery order. `state` drives the badge, so this list is the plan of record. */
const PLAN: { phase: string; title: string; state: "done" | "next" | "later"; body: string }[] = [
  {
    phase: "0",
    title: "Kernel — boundaries, ports, event bus",
    state: "done",
    body: "Module registry with nullable resolution, the contract file, the transactional outbox, the shared approval ledger, per-organisation switches, and lint rules that make a cross-module import a build failure.",
  },
  {
    phase: "1",
    title: "Organisation structure",
    state: "done",
    body: "Divisions, business units, sub business units, functional categories, projects and locations on one table with enforced parent rules; position levels, job titles, services and remuneration groups. Everything else keys off this, so it goes first.",
  },
  {
    phase: "2",
    title: "Calendar",
    state: "done",
    body: "Weekly-off patterns by branch and holiday groups scoped to branches, genders or named employees. One authority for “was this a working day”, because attendance, leave and payroll must never disagree about it.",
  },
  {
    phase: "3",
    title: "Attendance — device layer and calculation settings",
    state: "next",
    body: "Device registry with connection details and direction, raw punch import, organisation-wide calculation settings (minimum OT, rounding, break tracking, minimum punch difference), manual and force entry, and the recalculation run.",
  },
  {
    phase: "4",
    title: "Attendance — rosters and overtime",
    state: "next",
    body: "Day-wise and weekly rosters, bulk shift allocation, the shift plan grid, late/early requests, and overtime ceilings applied from the remuneration group.",
  },
  {
    phase: "5",
    title: "Leave — the policy engine",
    state: "done",
    body: "Leave groups, the leave master with nature, pay percentage and lapse rule, entitlement by employment type, per-salary-head pay overrides, maturity interference, and approval routing sized from the length of the request.",
  },
  {
    phase: "6",
    title: "Leave — the year",
    state: "next",
    body: "Bulk and partial-period allocation, opening balances, carry-forward, encashment and lapse runs, and substitute credits for work done on an off day. The tables are in place; the runs that move them are not.",
  },
  {
    phase: "7",
    title: "Payroll",
    state: "next",
    body: "Salary groups and heads, level-wise structure, TDS and the monthly run. The consuming half is built: payableDays() already assembles a month from the attendance and leave ports and marks the answer incomplete when either is unavailable. What is missing is the salary engine on top of it.",
  },
];

export default async function ModuleArchitecturePage() {
  await requirePermission("docs.read");

  return (
    <>
      <PageHeader
        title="Module architecture"
        description="How the functional modules are kept independent, and the order they are being built in."
      />

      <div className="flex flex-col gap-8">
        <DocSection
          title="The problem this solves"
          lead="Stated plainly, because every rule below follows from it."
        >
          <Callout tone="warn" title="How the legacy system failed">
            Leave wrote directly into attendance tables and attendance joined leave tables. Neither
            could be changed, deployed or repaired without the other, and a fault in one aborted
            work in the other — an approval could be rolled back after the approver had been told it
            succeeded. Add the shared menu tree in the database, and one bad row took the whole
            product down.
          </Callout>
          <div className="mt-3">
            <Prose>
              <p>
                The requirement here is narrow and testable: <strong>a fault in one module must not
                stop another module working.</strong> Not “the code is tidier” — a specific
                operational property, verified by{" "}
                <code className="font-mono text-xs">pnpm check:isolation</code> on every change.
              </p>
            </Prose>
          </div>
        </DocSection>

        <DocSection
          title="Four mechanisms"
          lead="Each one closes a different way modules become entangled."
        >
          <DefTable
            rows={[
              [
                "1 · Contracts, not imports",
                <>
                  <code className="font-mono text-xs">kernel/ports.ts</code> declares what each
                  module offers. It contains types and nothing else, so importing a contract cannot
                  drag another module&rsquo;s code or schema in. Ports return plain data, never
                  database rows — which is what lets a table change privately.
                </>,
              ],
              [
                "2 · Nullable resolution",
                <>
                  <code className="font-mono text-xs">resolve(&quot;attendance&quot;)</code> returns{" "}
                  <code className="font-mono text-xs">null</code> when that module is missing,
                  failed or switched off, and{" "}
                  <code className="font-mono text-xs">callPort()</code> turns a thrown error into a
                  fallback. The type system forces every call site to answer “what do I do without
                  it”.
                </>,
              ],
              [
                "3 · Events, not calls, for writes",
                <>
                  A module publishes inside its own transaction and returns. Others react
                  afterwards, in their own transaction. A subscriber failure is recorded against the
                  event and retried — it never rolls back the publisher.
                </>,
              ],
              [
                "4 · Enforcement",
                <>
                  ESLint refuses a cross-module import with the reason and the alternative. A
                  boundary that lives only in a document lasts until the first deadline.
                </>,
              ],
            ]}
          />
        </DocSection>

        <DocSection
          title="What the graph looks like"
          lead="Every arrow is a contract. There is no arrow between two functional modules."
        >
          <Figure caption="Modules depend on the kernel and on shared master data. Where two need to interact, one publishes and the other subscribes — the dashed line is a queue, not a call stack.">
            <svg viewBox="0 0 840 330" width="840" height="330" role="img" aria-label="Module dependency diagram">
              <ArrowDefs />

              <Pill x={300} y={10} w={240} h={44} label="kernel" sub="ports · registry · events · approvals" tone="accent" />

              <Pill x={40} y={110} w={150} label="people" sub="employee master" tone="sunk" />
              <Pill x={230} y={110} w={150} label="org" sub="structure · policy" tone="sunk" />
              <Pill x={420} y={110} w={150} label="calendar" sub="working days" tone="sunk" />
              <Pill x={640} y={110} w={160} label="core" sub="org · fiscal year" tone="sunk" />

              <Pill x={130} y={230} w={170} h={44} label="attendance" sub="shifts · days · requests" />
              <Pill x={370} y={230} w={170} h={44} label="leave" sub="policy · balances" />
              <Pill x={610} y={230} w={170} h={44} label="payroll" sub="planned" tone="warn" />

              <Arrow from={[380, 58]} to={[150, 106]} />
              <Arrow from={[400, 58]} to={[300, 106]} />
              <Arrow from={[440, 58]} to={[490, 106]} />
              <Arrow from={[520, 58]} to={[700, 106]} />

              <Arrow from={[190, 144]} to={[200, 226]} />
              <Arrow from={[300, 144]} to={[240, 226]} />
              <Arrow from={[470, 144]} to={[280, 226]} />
              <Arrow from={[470, 144]} to={[440, 226]} />
              <Arrow from={[280, 144]} to={[430, 226]} />
              <Arrow from={[700, 144]} to={[690, 226]} />

              <Arrow from={[370, 258]} to={[302, 258]} label="leave.approved" dashed />
              <Arrow from={[610, 262]} to={[542, 262]} dashed />

              <text x={40} y={310} fill="var(--color-ink-faint)" fontSize="10">
                attendance and leave never import each other; the only thing between them is an event on a queue.
              </text>
            </svg>
          </Figure>
        </DocSection>

        <DocSection
          title="What happens when something breaks"
          lead="Verified, not asserted — each row is a check in pnpm check:isolation."
        >
          <DefTable
            rows={[
              [
                "Attendance is down",
                "Leave still submits, routes and approves. The day marking sits in the queue and is applied when attendance returns. The month sheet is unavailable; nothing else is.",
              ],
              [
                "Leave is down",
                "Attendance still records, calculates and regularises. The register renders without leave colouring rather than failing — a missing colour is cosmetic, a sheet that will not load is not.",
              ],
              [
                "A module fails to boot",
                "It is recorded as failed and every other module registers normally. Callers get their fallback instead of an exception.",
              ],
              [
                "A subscriber keeps failing",
                "The event is retried five times, then parked as dead and counted on Administration › Modules, where it can be requeued once the cause is fixed. Nothing is lost silently.",
              ],
              [
                "A module is switched off",
                "Its screens leave the menu and its port stops resolving for that organisation only. It is the way to take one module out of service without a deployment.",
              ],
            ]}
          />
        </DocSection>

        <DocSection
          title="The rules, for anyone adding a module"
          lead="Five of them. The linter enforces the first two."
        >
          <Steps
            items={[
              {
                title: "Never import another module",
                body: (
                  <>
                    Not its service, not its schema, not its types. If you need something from it,
                    add a method to its port in{" "}
                    <code className="font-mono text-xs">kernel/ports.ts</code>.
                  </>
                ),
              },
              {
                title: "Never write another module's tables",
                body: (
                  <>
                    Publish an event and let that module decide what to do. Writing across a
                    boundary is how one module&rsquo;s migration becomes another&rsquo;s outage.
                  </>
                ),
              },
              {
                title: "Handle the null",
                body: (
                  <>
                    <code className="font-mono text-xs">resolve()</code> can return null at any time.
                    Decide what a degraded answer looks like — and prefer one that is visibly
                    incomplete over one that is quietly wrong.
                  </>
                ),
              },
              {
                title: "Make handlers idempotent",
                body: (
                  <>
                    Delivery is at-least-once. Key writes on the business fact — a leave request id,
                    not a timestamp — so a retry changes nothing the second time.
                  </>
                ),
              },
              {
                title: "Put shared things in the kernel",
                body: (
                  <>
                    The approval ledger moved out of leave for exactly this reason: attendance
                    needed it, and reaching for it meant importing leave. If two modules need it, it
                    was never module-specific.
                  </>
                ),
              },
            ]}
          />
        </DocSection>

        <DocSection
          title="Delivery order"
          lead="Dependencies decide the sequence: nothing is built before the thing it keys off."
        >
          <div className="flex flex-col gap-2">
            {PLAN.map((step) => (
              <div
                key={step.phase}
                className="flex gap-3 rounded-md border border-line bg-surface p-3"
              >
                <span className="tabular mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-sunk text-xs font-semibold text-ink-soft">
                  {step.phase}
                </span>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                    {step.title}
                    <Badge
                      tone={step.state === "done" ? "ok" : step.state === "next" ? "accent" : "neutral"}
                    >
                      {step.state === "done" ? "built" : step.state === "next" ? "in progress" : "planned"}
                    </Badge>
                  </p>
                  <p className="mt-0.5 max-w-[74ch] text-sm text-ink-soft">{step.body}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4">
            <Callout tone="info" title="Why this order">
              Attendance and leave both key off the organisation structure and the calendar, so
              those come first — building them later would mean rewriting whatever assumed a
              hard-coded Saturday. Attendance precedes leave because leave marks attendance days,
              and payroll comes last because it consumes both.
            </Callout>
          </div>
        </DocSection>
      </div>
    </>
  );
}
