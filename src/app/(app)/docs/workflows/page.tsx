import { requirePermission } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import { Arrow, ArrowDefs, Callout, DefTable, DocSection, Figure, Pill, Prose, Steps } from "../parts";

export const metadata = { title: "Workflows" };

export default async function WorkflowsPage() {
  await requirePermission("docs.read");

  return (
    <>
      <PageHeader
        title="Workflows"
        description="How a request moves from raised to decided, and what the system does at each step."
      />

      <div className="flex flex-col gap-8">
        <DocSection
          title="One approval engine"
          lead="Leave and attendance corrections do not have separate approval code, and neither will travel, expense or procurement."
        >
          <Prose>
            <p>
              When something is submitted, the whole chain of approvers is written at once into{" "}
              <code className="font-mono text-xs">approval_steps</code>, keyed by the kind of thing
              and its id. The screen can therefore say <em>who</em> it is waiting on, not merely
              that it is pending — the most common complaint about the system this replaces.
            </p>
            <p>
              A step is only actionable when every step below it is approved. A decision on a step
              that is not yet current is refused by the service, not hidden by the UI, so it cannot
              be forced by replaying a form.
            </p>
          </Prose>

          <div className="mt-4">
            <Figure caption="The generic chain. Levels are resolved from the reporting line at submission time, so a later reorganisation does not silently re-route a request already in flight.">
              <svg viewBox="0 0 820 210" width="820" height="210" role="img" aria-label="Approval chain diagram">
                <ArrowDefs />
                <Pill x={10} y={80} w={130} label="Submitted" sub="by the employee" tone="accent" />
                <Pill x={200} y={80} w={140} label="Level 1" sub="supervisor" />
                <Pill x={400} y={80} w={140} label="Level 2" sub="HR, if required" />
                <Pill x={600} y={30} w={140} label="Approved" sub="days become used" tone="accent" />
                <Pill x={600} y={130} w={140} label="Rejected" sub="days released" tone="warn" />

                <Arrow from={[140, 97]} to={[198, 97]} />
                <Arrow from={[340, 97]} to={[398, 97]} label="approve" />
                <Arrow from={[540, 90]} to={[598, 55]} label="approve" />
                <Arrow from={[540, 105]} to={[598, 150]} label="reject" />
                <Arrow from={[270, 114]} to={[640, 148]} dashed />

                <text x={190} y={190} fill="var(--color-ink-faint)" fontSize="9.5">
                  A rejection at any level ends the chain — the remaining steps are marked skipped, not left open.
                </text>
              </svg>
            </Figure>
          </div>
        </DocSection>

        <DocSection
          title="Leave"
          lead="Submitting reserves the days before it validates them, which is what makes two simultaneous submissions safe."
        >
          <Figure caption="Leave request lifecycle. Every balance movement happens in the same transaction as the status change, so a balance can never disagree with the request that moved it.">
            <svg viewBox="0 0 840 320" width="840" height="320" role="img" aria-label="Leave workflow diagram">
              <ArrowDefs />

              <Pill x={10} y={20} w={150} label="My Leave" sub="employee applies" tone="accent" />
              <Pill x={220} y={20} w={170} h={44} label="Validate" sub="entitlement · overlap · notice" />
              <Pill x={450} y={20} w={170} h={44} label="Reserve days" sub="pending += n" />
              <Pill x={680} y={20} w={150} label="Pending" sub="chain written" tone="sunk" />

              <Pill x={680} y={130} w={150} label="Approvals" sub="level by level" />
              <Pill x={450} y={130} w={170} h={44} label="Approved" sub="pending → used" tone="accent" />
              <Pill x={220} y={130} w={170} h={44} label="Rejected" sub="pending released" tone="warn" />
              <Pill x={10} y={130} w={150} label="Withdrawn" sub="by the employee" tone="sunk" />

              <Pill x={450} y={240} w={170} label="Attendance days" sub="marked on leave" tone="sunk" />
              <Pill x={220} y={240} w={170} label="Balance meters" sub="update everywhere" tone="sunk" />

              <Arrow from={[160, 37]} to={[218, 40]} />
              <Arrow from={[390, 42]} to={[448, 42]} />
              <Arrow from={[620, 42]} to={[678, 37]} />
              <Arrow from={[755, 54]} to={[755, 126]} />
              <Arrow from={[678, 152]} to={[622, 152]} label="all levels" />
              <Arrow from={[678, 165]} to={[392, 168]} label="any reject" dashed />
              <Arrow from={[220, 168]} to={[162, 155]} dashed />
              <Arrow from={[535, 174]} to={[535, 236]} />
              <Arrow from={[448, 258]} to={[392, 258]} />

              <text x={10} y={302} fill="var(--color-ink-faint)" fontSize="10">
                Reserve-then-check, under a row lock: two submissions for the same last remaining day cannot both succeed.
              </text>
            </svg>
          </Figure>

          <div className="mt-4">
            <DefTable
              rows={[
                [
                  "Half days",
                  "A half day counts 0.5 against the balance and leaves the other half of the attendance day payable.",
                ],
                [
                  "Weekly offs and holidays",
                  "Excluded from the day count. Saturday is the weekly off; holidays come from Organisation › Holidays for the fiscal year.",
                ],
                [
                  "Notice period",
                  "Leave types can require notice. A shorter request is refused at submission, saying how many days are required, rather than being approved and then queried.",
                ],
                [
                  "Overlap",
                  "A date already covered by a pending or approved request is refused. Withdraw the first one to re-request.",
                ],
                [
                  "Locked periods",
                  "A closed month refuses new requests and decisions against it — see Organisation › Fiscal Years.",
                ],
              ]}
            />
          </div>
        </DocSection>

        <DocSection
          title="Attendance correction"
          lead="The daily record is derived from the punches, so a correction changes the punch and lets the calculation follow."
        >
          <Figure caption="Correction lifecycle. Approving writes the punch and re-runs the same calculation the device import runs, so a corrected day and an imported day are computed identically.">
            <svg viewBox="0 0 820 250" width="820" height="250" role="img" aria-label="Attendance correction diagram">
              <ArrowDefs />

              <Pill x={10} y={20} w={160} label="Device import" sub="raw punches" tone="sunk" />
              <Pill x={230} y={20} w={170} h={44} label="Recalculate day" sub="calc.ts, pure" tone="accent" />
              <Pill x={460} y={20} w={160} label="attendance_days" sub="status + minutes" />
              <Pill x={680} y={20} w={130} label="Month sheet" />

              <Pill x={10} y={140} w={160} label="My Requests" sub="employee explains" tone="accent" />
              <Pill x={230} y={140} w={170} label="Supervisor decides" />
              <Pill x={460} y={140} w={160} h={44} label="Punch written" sub="then recalculated" />
              <Pill x={680} y={140} w={130} label="Audit row" sub="who, when, why" tone="sunk" />

              <Arrow from={[170, 37]} to={[228, 40]} />
              <Arrow from={[400, 42]} to={[458, 37]} />
              <Arrow from={[620, 37]} to={[678, 37]} />
              <Arrow from={[170, 157]} to={[228, 157]} />
              <Arrow from={[400, 157]} to={[458, 157]} label="approve" />
              <Arrow from={[620, 162]} to={[678, 160]} />
              <Arrow from={[540, 138]} to={[400, 68]} label="re-runs" dashed />

              <text x={10} y={230} fill="var(--color-ink-faint)" fontSize="10">
                Statuses: present · late · half_day · missing_punch · absent · weekly_off · holiday · on_leave
              </text>
            </svg>
          </Figure>

          <div className="mt-4">
            <Callout tone="info" title="Why a row exists for every day">
              The legacy system only wrote a row when somebody punched, so <em>absent</em> and{" "}
              <em>not imported yet</em> looked the same in every report. Here a row exists for every
              day of the month — including weekly offs, holidays and leave — and the status says
              which it is.
            </Callout>
          </div>
        </DocSection>

        <DocSection
          id="leave-effects"
          title="What a leave type decides"
          lead="One approved request changes three modules. Three columns on the leave type decide how — and nothing else in the product is allowed a say."
        >
          <Prose>
            <p>
              The legacy system spread this across a boolean called{" "}
              <code className="font-mono text-xs">IsPaid</code>, a{" "}
              <code className="font-mono text-xs">LeaveTypeID</code> that some reports switched on,
              and a salary-head relation table — and the three disagreed. Unpaid leave was paid in
              one report and deducted in another, and nobody could say which was right without
              reading the SQL.
            </p>
            <p>
              Here a leave type states its <strong>nature</strong>, its{" "}
              <strong>pay percentage</strong> and its <strong>lapse rule</strong>. Attendance turns
              the nature into a daily status. Payroll turns the percentage into money. Neither reads
              a leave table to do it — both receive the values on the approval event.
            </p>
          </Prose>

          <div className="mt-4">
            <Figure caption="One approval, three consequences. The dashed lines are the event queue: leave commits its own work and returns, and the other two react afterwards.">
              <svg viewBox="0 0 860 300" width="860" height="300" role="img" aria-label="Leave effect on attendance and payroll">
                <ArrowDefs />

                <Pill x={20} y={20} w={190} h={48} label="Leave type" sub="nature · pay % · lapse" tone="accent" />
                <Pill x={20} y={130} w={190} h={44} label="Approved request" sub="dates + policy" />

                <Pill x={300} y={125} w={180} h={54} label="leave.request.approved" sub="one event, carrying both" tone="warn" />

                <Pill x={580} y={30} w={250} h={54} label="Attendance" sub="nature → daily status" />
                <Pill x={580} y={200} w={250} h={54} label="Payroll" sub="pay % → payable days" />

                <Arrow from={[115, 72]} to={[115, 126]} label="policy" />
                <Arrow from={[212, 152]} to={[296, 152]} />
                <Arrow from={[482, 140]} to={[576, 70]} dashed />
                <Arrow from={[482, 165]} to={[576, 216]} dashed />

                <text x={584} y={106} fill="var(--color-ink-faint)" fontSize="10">
                  paid · unpaid · substitute → on leave
                </text>
                <text x={584} y={120} fill="var(--color-ink-faint)" fontSize="10">
                  field work · travel → present
                </text>
                <text x={584} y={134} fill="var(--color-ink-faint)" fontSize="10">
                  absence → absent · closure → holiday
                </text>

                <text x={584} y={276} fill="var(--color-ink-faint)" fontSize="10">
                  100% paid · 50% study leave · 0% unpaid, per salary head
                </text>

                <text x={20} y={288} fill="var(--color-ink-faint)" fontSize="10">
                  Attendance down? The approval still commits and the marking waits in the queue.
                </text>
              </svg>
            </Figure>
          </div>

          <div className="mt-4">
            <DefTable
              rows={[
                [
                  "Field work · Travel",
                  <>
                    Counts as <strong>present</strong>, paid in full, and deducts no balance. A site
                    engineer out for three days should not fail an attendance target for working —
                    which is what happened when the old system booked field work as leave.
                  </>,
                ],
                [
                  "Paid leave",
                  "Counts as leave, paid at the type's percentage. The ordinary case, and the only one most types need.",
                ],
                [
                  "Unpaid leave",
                  "Counts as leave and pays nothing. Payroll sees the days separately from absence, because the two are queried for different reasons.",
                ],
                [
                  "Study leave at 50%",
                  <>
                    One number, not a special case. A per-head override on top of it pays basic in
                    full and allowances at half — the reason the salary-head relation exists, kept
                    as an <em>override</em> rather than a second source of truth.
                  </>,
                ],
                [
                  "Absence",
                  "Counts as absent and pays nothing. Distinct from unpaid leave: one was approved, the other was not.",
                ],
                [
                  "Closure",
                  "A strike or curfew day. Counts as a holiday and is charged to nobody.",
                ],
                [
                  "Substitute",
                  "Time back for a weekly off that was worked. Consumes a credit rather than an entitlement.",
                ],
              ]}
            />
          </div>

          <div className="mt-4">
            <Callout tone="info" title="Who may approve how much">
              A leave type can cap what each level signs off — five days for a supervisor, fifteen
              for a manager. The chain is sized at submission from the length of the request, so a
              twenty-day request goes straight to the level that can actually approve it instead of
              being forwarded by hand. <strong>Leave › Leave Policy</strong> shows every ceiling.
            </Callout>
          </div>
        </DocSection>

        <DocSection title="Raising something, step by step">
          <Steps
            items={[
              {
                title: "Apply for leave",
                body: (
                  <>
                    <strong>Leave › My Leave</strong> → <em>Apply</em>. Pick the type, the dates in
                    Bikram Sambat, and say why. Your remaining balance for that type is shown before
                    you submit.
                  </>
                ),
              },
              {
                title: "Correct a punch",
                body: (
                  <>
                    <strong>Attendance › My Requests</strong> → <em>New request</em>. Choose the
                    date, the corrected time and the reason. The record currently held for that day
                    is shown beside it.
                  </>
                ),
              },
              {
                title: "Decide, as an approver",
                body: (
                  <>
                    Items waiting on you appear on your dashboard and under{" "}
                    <strong>Leave › Approvals</strong> or <strong>Attendance › Approvals</strong>.
                    Approve or reject with a note — the note is shown to the requester and kept in
                    the audit trail.
                  </>
                ),
              },
              {
                title: "Close the month",
                body: (
                  <>
                    <strong>Organisation › Fiscal Years</strong> → the lock board. Locking a Bikram
                    Sambat month for attendance also stamps every day in it, so nothing further can
                    be changed against a period already reported on.
                  </>
                ),
              },
            ]}
          />
        </DocSection>
      </div>
    </>
  );
}
