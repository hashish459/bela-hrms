import type { ReactNode } from "react";
import Link from "next/link";
import { requirePermission } from "@/lib/session";
import { APP } from "@/lib/branding";
import { PageHeader } from "@/components/ui";
import { Callout, DocSection } from "../parts";

export const metadata = { title: "FAQ" };

type Qa = { q: string; a: ReactNode };

function Answers({ items }: { items: Qa[] }) {
  return (
    <div className="divide-y divide-line-soft overflow-hidden rounded-md border border-line bg-surface">
      {items.map((item) => (
        <details key={item.q} className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-ink transition-colors hover:bg-sunk">
            {item.q}
            <span
              aria-hidden
              className="shrink-0 text-ink-faint transition-transform group-open:rotate-45"
            >
              +
            </span>
          </summary>
          <div className="max-w-[68ch] px-4 pb-4 text-sm text-ink-soft">{item.a}</div>
        </details>
      ))}
    </div>
  );
}

export default async function FaqPage() {
  await requirePermission("docs.read");

  return (
    <>
      <PageHeader
        title="Frequently asked questions"
        description="The questions people actually ask, grouped by what they are trying to do."
      />

      <div className="flex flex-col gap-8">
        <DocSection title="Signing in and access">
          <Answers
            items={[
              {
                q: "I cannot sign in — what should I check first?",
                a: (
                  <>
                    Use the work email address held on your employee record, not a personal one. If
                    the message says the account is disabled, HR has deactivated it and no password
                    will work until it is re-enabled. If you have forgotten the password, an
                    administrator can issue a new temporary one from{" "}
                    <strong>Administration › Users</strong>.
                  </>
                ),
              },
              {
                q: "Why is my menu shorter than my colleague's?",
                a: (
                  <>
                    The sidebar only lists screens your role can open — that is the whole design.
                    Ask an administrator which role holds the screen you need; every permission is
                    listed by module under <strong>Administration › Roles</strong>.
                  </>
                ),
              },
              {
                q: "I opened a link and got “403 forbidden”.",
                a: (
                  <>
                    The route exists but your role does not hold its permission. The check runs on
                    the server for every page and every action, so hiding a menu item is never the
                    only thing stopping access.
                  </>
                ),
              },
              {
                q: "Can one person have more than one role?",
                a: (
                  <>
                    Yes. Permissions from all assigned roles are added together — there is no “deny”
                    that overrides a grant, so adding a role can only widen access. A user must
                    always have at least one.
                  </>
                ),
              },
            ]}
          />
        </DocSection>

        <DocSection title="Attendance">
          <Answers
            items={[
              {
                q: "My day says “missing punch”. What now?",
                a: (
                  <>
                    Only one punch reached the system. Nothing is assumed for the other — raise a
                    correction under <strong>Attendance › My Requests</strong> with the real time
                    and the reason. Once your supervisor approves it, the punch is written and the
                    day is recalculated immediately.
                  </>
                ),
              },
              {
                q: "I was on time but I am marked late.",
                a: (
                  <>
                    Lateness is measured against your shift start plus its grace period, not against
                    a fixed office hour. If the wrong shift is assigned to you, that is an HR fix
                    under <strong>Attendance › Shift Master</strong> and the roster, not a correction
                    request.
                  </>
                ),
              },
              {
                q: "Why is Saturday shown but not counted?",
                a: (
                  <>
                    Saturday is the weekly off, and a row exists for it so the month sheet is
                    continuous. It is never counted as an absence, and leave taken across it does
                    not consume a day.
                  </>
                ),
              },
              {
                q: "My correction was refused because the month is locked.",
                a: (
                  <>
                    That month has been closed — usually because payroll has been run against it.
                    Only someone with period-lock rights can reopen it, from{" "}
                    <strong>Organisation › Fiscal Years</strong>.
                  </>
                ),
              },
              {
                q: "Is overtime automatic?",
                a: (
                  <>
                    Minutes beyond the shift are computed on every day, but whether they are payable
                    depends on the shift&rsquo;s overtime rule. The figure on your sheet is the computed
                    one; payroll applies the rule when that module lands.
                  </>
                ),
              },
            ]}
          />
        </DocSection>

        <DocSection title="Leave">
          <Answers
            items={[
              {
                q: "What is the difference between “pending” and “used” days?",
                a: (
                  <>
                    Pending days are reserved by a request nobody has decided yet — they are already
                    out of your available balance, which is what stops you spending the same day
                    twice. Approval turns them into used days; rejection or withdrawal returns them
                    straight away.
                  </>
                ),
              },
              {
                q: "My balance went down before anyone approved it.",
                a: (
                  <>
                    That is intended. Days are reserved at submission, so two requests raised at the
                    same moment cannot both be approved against a balance that only covers one.
                  </>
                ),
              },
              {
                q: "Do weekends and holidays inside my leave count?",
                a: (
                  <>
                    No. Saturdays and any holiday configured for the fiscal year are excluded from
                    the day count, so a Friday-to-Sunday request costs two days, not three.
                  </>
                ),
              },
              {
                q: "Can I cancel leave I already applied for?",
                a: (
                  <>
                    While it is pending, yes — withdraw it and the days come back at once. Once
                    approved, HR has to reverse it, because the attendance days for the period have
                    already been marked.
                  </>
                ),
              },
              {
                q: "It says I have not given enough notice.",
                a: (
                  <>
                    Each leave type can require a number of days&rsquo; notice. The message says how many
                    are required; the request is refused at submission rather than approved and then
                    questioned.
                  </>
                ),
              },
              {
                q: "Who does my request go to?",
                a: (
                  <>
                    Your supervisor on the reporting line, resolved when you submit. The request
                    names the person it is waiting on. If you have no supervisor set, tell HR — the
                    request has nowhere to go.
                  </>
                ),
              },
            ]}
          />
        </DocSection>

        <DocSection title="Dates and the fiscal year">
          <Answers
            items={[
              {
                q: "Which calendar does the system use?",
                a: (
                  <>
                    Both. Dates are entered and displayed in Bikram Sambat and stored Gregorian, so
                    sorting and ranges behave correctly and reports can be produced in either. The
                    header shows today in both.
                  </>
                ),
              },
              {
                q: "Why does everything change when the fiscal year changes?",
                a: (
                  <>
                    Balances, holidays and locks are all scoped to a fiscal year — Shrawan 1 to
                    Ashadh end. Exactly one year can be current, and the database enforces that with
                    a partial unique index rather than trusting the screen that sets it.
                  </>
                ),
              },
              {
                q: "What does locking a month actually do?",
                a: (
                  <>
                    It refuses new requests and decisions for that module and month, and for
                    attendance it also stamps every day in the month as locked — so a correction
                    cannot slip through by another route. Both writes happen in one transaction.
                  </>
                ),
              },
            ]}
          />
        </DocSection>

        <DocSection title="The application itself">
          <Answers
            items={[
              {
                q: "Can I change the colours, font or text size?",
                a: (
                  <>
                    Yes — <strong>Administration › Appearance</strong>: light, dark or follow the
                    system, typeface, text size, density, accent colour and a high-contrast mode.
                    The choice is yours alone, stored in this browser, and applied before the first
                    paint so there is no flash of the wrong theme.
                  </>
                ),
              },
              {
                q: "Does it work on a phone?",
                a: (
                  <>
                    The layout is responsive and the sidebar collapses; approvals and applying for
                    leave are usable on a handset. The month sheet and the lock board are dense
                    tables and are better on a desktop.
                  </>
                ),
              },
              {
                q: "Half the menu says “soon”. Is it broken?",
                a: (
                  <>
                    No — those are planned screens, deliberately in the menu from day one so the
                    shape of the product is agreed before the modules land. Each one opens a page
                    describing what will live there. See{" "}
                    <Link href="/docs/roadmap" className="text-accent hover:underline">
                      the roadmap
                    </Link>
                    .
                  </>
                ),
              },
              {
                q: "Where did the data come from?",
                a: (
                  <>
                    {APP.name} replaces the Nimble.Ananta HRIS. Its schema was recovered table by
                    table and the Bikram Sambat calendar was extracted from the original
                    application, so converted dates agree with everything the old system stored.
                  </>
                ),
              },
              {
                q: "Is there an audit trail?",
                a: (
                  <>
                    Every decision, correction and administrative change writes an audit row with
                    who, when and why, visible under <strong>Administration › Audit Trail</strong>.
                  </>
                ),
              },
            ]}
          />
        </DocSection>

        <DocSection title="Still stuck">
          <Callout tone="info" title="Where to look next">
            <Link href="/docs/manual" className="underline">
              The user manual
            </Link>{" "}
            walks through each screen in order,{" "}
            <Link href="/docs/workflows" className="underline">
              Workflows
            </Link>{" "}
            diagrams how a request moves, and{" "}
            <Link href="/docs/architecture" className="underline">
              Architecture
            </Link>{" "}
            explains how the system is put together. For anything else, contact the HR department at{" "}
            {APP.company}.
          </Callout>
        </DocSection>
      </div>
    </>
  );
}
