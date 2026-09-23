import Link from "next/link";
import { can, requirePermission } from "@/lib/session";
import { APP } from "@/lib/branding";
import { PageHeader, Badge } from "@/components/ui";
import { Callout, DefTable, DocSection, Prose, Steps } from "../parts";

export const metadata = { title: "User manual" };

const CHAPTERS = [
  { id: "signing-in", label: "Signing in" },
  { id: "getting-around", label: "Getting around" },
  { id: "attendance", label: "Attendance" },
  { id: "leave", label: "Leave" },
  { id: "approving", label: "Approving" },
  { id: "employees", label: "Employees" },
  { id: "documents", label: "Documents" },
  { id: "confirmations", label: "Confirmations" },
  { id: "organisation", label: "Organisation" },
  { id: "administration", label: "Administration" },
  { id: "appearance", label: "Appearance" },
];

/** Marks a chapter the reader can actually act on with their current permissions. */
function Access({ ok, need }: { ok: boolean; need: string }) {
  return ok ? (
    <Badge tone="ok">You have access</Badge>
  ) : (
    <Badge tone="neutral">Needs {need}</Badge>
  );
}

export default async function ManualPage() {
  const viewer = await requirePermission("docs.read");

  const isApprover =
    can(viewer, "leave.request.approve") || can(viewer, "attendance.request.approve");
  const isHr = can(viewer, "hr.employee.view");
  const isDocuments = can(viewer, "hr.document.manage");
  const isSetup = can(viewer, "setup.structure.view");
  const isAdmin = can(viewer, "admin.user.view") || can(viewer, "admin.role.manage");

  return (
    <>
      <PageHeader
        title="User manual"
        description={`Everything you can do in ${APP.name}, in the order you are likely to need it.`}
      />

      <div className="flex flex-col gap-8">
        <nav className="rounded-md border border-line bg-surface p-3">
          <p className="mb-2 text-[11px] tracking-wide text-ink-faint uppercase">Chapters</p>
          <div className="flex flex-wrap gap-1.5">
            {CHAPTERS.map((c) => (
              <a
                key={c.id}
                href={`#${c.id}`}
                className="rounded border border-line px-2 py-1 text-xs text-ink-soft transition-colors hover:border-accent hover:text-accent"
              >
                {c.label}
              </a>
            ))}
          </div>
        </nav>

        <DocSection
          id="signing-in"
          title="1 · Signing in"
          lead="Your account is created for you by HR or an administrator; there is no self sign-up."
        >
          <Steps
            items={[
              {
                title: "Use your work email address",
                body: (
                  <>
                    The same address held against your employee record. If sign-in says the account
                    is disabled, your record has been deactivated — ask HR.
                  </>
                ),
              },
              {
                title: "Change the password you were given",
                body: (
                  <>
                    A new account is marked <em>must change password</em>. You will be asked once,
                    at first sign-in, and cannot skip it.
                  </>
                ),
              },
              {
                title: "Check the header",
                body: (
                  <>
                    Today in both calendars, the current fiscal year, and your name. Everything you
                    see is scoped to that fiscal year.
                  </>
                ),
              },
            ]}
          />
          <div className="mt-3">
            <Callout tone="info" title="Sign-ins are recorded">
              Each sign-in stamps your account and writes an audit row. Administrators can see the
              trail under <strong>Administration › Audit Trail</strong> — which is also how an account
              being used by somebody else would be spotted.
            </Callout>
          </div>
        </DocSection>

        <DocSection
          id="getting-around"
          title="2 · Getting around"
          lead="The sidebar shows only what your role can open, so two people rarely see the same menu."
        >
          <DefTable
            rows={[
              [
                "Modules",
                "Click a module to open or close its screens. The module you are working in opens itself, and whatever you leave open is remembered the next time you sign in on this browser.",
              ],
              [
                "Search",
                <>
                  Press <kbd className="rounded border border-line px-1 font-mono text-[11px]">/</kbd>{" "}
                  anywhere to jump to a screen by name, without opening its module first.
                </>,
              ],
              [
                "Collapse",
                "The sidebar collapses to icons for a wider working area. The choice is remembered in this browser.",
              ],
              [
                "“Soon” screens",
                "Real routes that describe what will live there. They are in the menu from day one so the shape of the product does not shift as modules land.",
              ],
              [
                "Missing something?",
                "If a screen you expect is absent, it is a permission, not a fault. Ask an administrator which role holds it.",
              ],
            ]}
          />
        </DocSection>

        <DocSection
          id="attendance"
          title="3 · Attendance"
          lead="Your daily record, and how to fix it when it is wrong."
        >
          <Prose>
            <p>
              <strong>Attendance › My Attendance</strong> shows one row for every day of the Bikram
              Sambat month — including Saturdays, holidays and days you were on leave — with the
              punches, minutes worked, lateness and overtime.
            </p>
          </Prose>
          <div className="mt-3">
            <DefTable
              rows={[
                ["Present", "In and out both recorded, and enough minutes worked for the shift."],
                ["Late", "Arrived after the shift start plus its grace period. Still a full working day."],
                ["Half day", "Fewer minutes worked than the shift's half-day threshold."],
                ["Missing punch", "One punch only. Nothing is assumed for the other — raise a correction."],
                ["Absent", "A working day with no punch at all and no approved leave."],
                ["Weekly off / Holiday / On leave", "Not a working day. Never counted against you."],
              ]}
            />
          </div>
          <div className="mt-4">
            <Steps
              items={[
                {
                  title: "Raise a correction",
                  body: (
                    <>
                      <strong>Attendance › My Requests</strong> → <em>New request</em>. Give the
                      date, the corrected time and the reason. It goes to your supervisor.
                    </>
                  ),
                },
                {
                  title: "Watch it",
                  body: (
                    <>
                      The request lists the approver it is waiting on. Once approved, the punch is
                      written and the day is recalculated straight away — you do not need to ask for
                      the record to be refreshed.
                    </>
                  ),
                },
                {
                  title: "If the month is locked",
                  body: (
                    <>
                      A closed month refuses corrections. Payroll has been run against it; ask HR
                      whether it can be reopened.
                    </>
                  ),
                },
              ]}
            />
          </div>
        </DocSection>

        <DocSection
          id="leave"
          title="4 · Leave"
          lead="Balances, applying, and what happens to the days while you wait."
        >
          <Steps
            items={[
              {
                title: "Check the balance first",
                body: (
                  <>
                    <strong>Leave › My Leave</strong> shows every type you are entitled to:
                    allotted, used, pending and available. <em>Pending</em> days are already
                    reserved by a request that has not been decided.
                  </>
                ),
              },
              {
                title: "Apply",
                body: (
                  <>
                    Pick the type and the dates in Bikram Sambat, say whether it is a half day, and
                    give the reason. Weekly offs and holidays inside the range are not counted.
                  </>
                ),
              },
              {
                title: "Wait, or withdraw",
                body: (
                  <>
                    A pending request can be withdrawn by you, which returns the reserved days
                    immediately. Once approved, only HR can reverse it.
                  </>
                ),
              },
              {
                title: "After approval",
                body: (
                  <>
                    The days move from pending to used and the matching attendance days are marked{" "}
                    <em>on leave</em>, so they are not counted as absences.
                  </>
                ),
              },
            ]}
          />
          <div className="mt-3">
            <DefTable
              rows={[
                [
                  "Not all leave is absence",
                  <>
                    Field work and travel are leave types, but they count as a{" "}
                    <strong>present</strong> day and deduct nothing — raise them the same way, and
                    your attendance is unaffected.
                  </>,
                ],
                [
                  "Pay follows the type",
                  <>
                    Each type states what it pays: 100% for ordinary paid leave, 50% for study
                    leave, nothing for leave without pay. <strong>Leave › Leave Policy</strong>{" "}
                    lists every figure, and payroll uses no other source.
                  </>,
                ],
                [
                  "Your entitlement depends on your contract",
                  "A permanent employee and a contract employee are entitled to different days of the same leave. The figure shown when you apply is already yours, not the headline number.",
                ],
                [
                  "Longer requests go higher",
                  "A type can cap what each approval level may sign off. A request past your supervisor's ceiling is routed to the level above from the start — it has not been forwarded, and nobody has sat on it.",
                ],
              ]}
            />
          </div>

          <div className="mt-3">
            <Callout tone="warn" title="Requests that will be refused">
              Dates overlapping a request you already have; more days than you have available;
              shorter notice than the leave type requires; or any date inside a locked period. The
              message says which, so nothing is refused without a reason.
            </Callout>
          </div>
        </DocSection>

        <DocSection id="approving" title="5 · Approving">
          <div className="mb-3">
            <Access ok={isApprover} need="an approver role" />
          </div>
          <Prose>
            <p>
              Anything waiting on you is on your dashboard, and in full under{" "}
              <strong>Leave › Approvals</strong> and <strong>Attendance › Approvals</strong>. You
              only see the step that is actually yours to decide — an earlier level not yet approved
              is not shown as actionable.
            </p>
            <p>
              Approve or reject with a note. The note goes back to the requester and into the audit
              trail, so a rejection is never unexplained. Rejecting ends the chain: later levels are
              marked skipped rather than left open.
            </p>
          </Prose>
        </DocSection>

        <DocSection id="employees" title="6 · Employees">
          <div className="mb-3">
            <Access ok={isHr} need="hr.employee.view" />
          </div>
          <Prose>
            <p>
              <strong>Employees › Employees</strong> is the master every other module keys off — the
              employment record, placement, statutory identifiers (PAN, SSF, PF, CIT) and the
              reporting line.
            </p>
            <p>
              Open anybody from the list to see their record in full: employment and placement,
              statutory identifiers, leave balances, what is on file, and anything falling due.
              Deadlines are shown at the top rather than buried in a tab, because the way a
              personnel record fails is not that the data is missing — it is that nobody looked at
              it in time.
            </p>
            <p>
              <strong>The photograph.</strong> Hover the circle on a profile and use the camera
              button. The picture is resized in your browser before it is sent, so a six-megabyte
              phone photo arrives as a few tens of kilobytes; you do not need to shrink it first.
              JPEG, PNG and WebP are accepted, and the file is checked by its actual contents
              rather than its name. <em>Remove</em> clears it and the initials come back.
            </p>
            <p>
              <strong>Reporting lines.</strong> The line is what routes approvals, so it matters
              more than it looks — level one is the direct supervisor, level two theirs, and
              somebody with no supervisor has nowhere for their requests to go.{" "}
              <strong>Employees › Reporting Lines</strong> charts the whole organisation and counts
              how many people are unassigned or report to somebody who has left.
            </p>
            <p>
              Press <strong>Edit reporting lines</strong> to change them in place. Each person gets
              a supervisor list that leaves out themselves and everybody already beneath them,
              because moving somebody under their own subordinate would close a loop — an approval
              that can never be routed. The same rule is enforced again when the change is saved.
            </p>
          </Prose>
        </DocSection>

        <DocSection id="documents" title="7 · Documents">
          <div className="mb-3">
            <Access ok={isDocuments} need="hr.document.manage" />
          </div>
          <Prose>
            <p>
              <strong>Employees › Documents</strong> is the register of contracts, certificates and
              identity papers held against each person — and, more usefully, of the ones that are
              about to stop being valid. You can also file a document directly from the Documents
              card on somebody&rsquo;s profile.
            </p>
          </Prose>
          <div className="mt-3">
            <DefTable
              rows={[
                [
                  "Filing one",
                  "Type, title, reference number, issue and expiry dates, and optionally a scan — JPEG, PNG, WebP or PDF up to 5 MB. Leave the expiry blank for anything that does not expire. A document can be filed before its scan arrives; the register marks which ones have no file attached.",
                ],
                [
                  "Expiry reminders",
                  "The tiles and the Renewal reminders card count the whole organisation, not the page you are looking at. Anything expired or expiring within sixty days is flagged, soonest first.",
                ],
                [
                  "Verifying",
                  "A newly filed document is pending until somebody checks the scan against the original and marks it verified. Rejecting one asks for a reason, and the employee sees that reason on their own profile so they know what to re-send.",
                ],
                [
                  "Editing resets a verification",
                  "Changing a verified document puts it back to pending. The tick said somebody checked that scan; once the scan or the reference changes, it no longer refers to anything.",
                ],
                [
                  "Visible to the employee",
                  "On by default. Uncheck it for anything held on file but not for their eyes — an investigation note, a reference. Hidden documents never appear on the employee desk, and the file itself cannot be fetched by them either.",
                ],
                [
                  "Sharing a view",
                  "The filters live in the address bar, so “everything expiring soon” is a link you can send to whoever has to chase it.",
                ],
              ]}
            />
          </div>
        </DocSection>

        <DocSection id="confirmations" title="8 · Confirmations">
          <div className="mb-3">
            <Access ok={isHr} need="hr.employee.view" />
          </div>
          <Prose>
            <p>
              <strong>Employees › Confirmations</strong> lists everybody on probation, sorted so the
              thing that has been waiting longest is at the top. Recording the decision needs
              permission to edit employees; without it the queue is still readable.
            </p>
            <p>
              People with <strong>no probation end date</strong> sort near the top rather than at
              the bottom. Nothing will ever fall due for them, which is exactly how the previous
              system lost track of staff for years at a time.
            </p>
          </Prose>
          <div className="mt-3">
            <Steps
              items={[
                {
                  title: "Open the review in the row",
                  body: "Press Review. The decision is taken in the table rather than on a separate screen, so a queue of fifteen is one sitting.",
                },
                {
                  title: "Choose the outcome",
                  body: "Confirm moves the person onto the permanent establishment from the effective date. Extend probation keeps them on probation until a new date you set. Do not confirm ends the engagement.",
                },
                {
                  title: "Give the reason",
                  body: "Optional when confirming, required for an extension or a termination — that is the decision somebody may be asked to justify later.",
                },
                {
                  title: "Record it",
                  body: "The employee record and the decision are written together, in one transaction. The decision stays on their profile under Probation history, with the date and who took it.",
                },
              ]}
            />
          </div>
          <div className="mt-3">
            <Callout tone="info" title="If somebody else got there first">
              Two people working the queue at once is ordinary, not an edge case. If a decision has
              already been recorded, the second attempt is refused with a message saying so rather
              than overwriting it.
            </Callout>
          </div>
        </DocSection>

        <DocSection id="organisation" title="9 · Organisation">
          <div className="mb-3">
            <Access ok={isSetup} need="setup.structure.view" />
          </div>
          <DefTable
            rows={[
              [
                "Fiscal Years",
                "Create a year from its Bikram Sambat start, and mark one current. Exactly one can be current at a time — the database enforces it, not just the screen.",
              ],
              [
                "Period locks",
                "The board on the same screen closes a module for a Bikram Sambat month. Locking attendance also stamps the days in that month, so corrections cannot slip through afterwards.",
              ],
              [
                "Holidays",
                "Per fiscal year, entered in Bikram Sambat. Holidays are excluded from leave day counts and produce a holiday attendance status.",
              ],
              [
                "Structure",
                "Branches, departments and designations — the placement an employee record points at.",
              ],
              [
                "Shifts",
                "Kept with the rest of attendance, under Attendance › Shift Master: start and end, grace period, half-day threshold and overtime rules. A shift is what turns two punches into a status, and Shift Assignment says who is on which.",
              ],
            ]}
          />
        </DocSection>

        <DocSection id="administration" title="10 · Administration">
          <div className="mb-3">
            <Access ok={isAdmin} need="admin.user.view" />
          </div>
          <Steps
            items={[
              {
                title: "Create a user",
                body: (
                  <>
                    <strong>Administration › Users</strong> → <em>New user</em>. Link it to an
                    employee record and give it at least one role. The first password is temporary
                    and must be changed at first sign-in.
                  </>
                ),
              },
              {
                title: "Disable rather than delete",
                body: (
                  <>
                    Deactivating keeps the history intact and stops the sign-in. You cannot disable
                    your own account, and you cannot leave a user with no role.
                  </>
                ),
              },
              {
                title: "Edit a role",
                body: (
                  <>
                    <strong>Administration › Roles</strong> shows every permission the build defines,
                    grouped by module, as a checkbox matrix. Saving replaces the whole set for that
                    role.
                  </>
                ),
              },
              {
                title: "Do not lock yourself out",
                body: (
                  <>
                    Removing role management from your own role is refused if you are the last
                    holder of it. There is no back door if it succeeds.
                  </>
                ),
              },
            ]}
          />
        </DocSection>

        <DocSection
          id="appearance"
          title="9 · Appearance"
          lead="Personal to you and this browser — it changes nothing for anybody else."
        >
          <Prose>
            <p>
              <strong>Administration › Appearance</strong> sets the theme (light, dark or follow the
              system), the typeface, the text size, the density and the accent colour, with a live
              preview. High contrast is there for shop-floor screens in daylight.
            </p>
            <p>
              The choice is applied before the first paint, so there is no flash of the wrong theme
              on load.
            </p>
          </Prose>
          <div className="mt-3">
            <Prose>
              <p>
                Still stuck? <Link href="/docs/faq" className="text-accent hover:underline">The FAQ</Link>{" "}
                covers the questions people actually ask, and{" "}
                <Link href="/docs/workflows" className="text-accent hover:underline">Workflows</Link>{" "}
                shows each process as a diagram.
              </p>
            </Prose>
          </div>
        </DocSection>
      </div>
    </>
  );
}
