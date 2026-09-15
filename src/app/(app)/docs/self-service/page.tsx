import { requirePermission } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import {
  Arrow,
  ArrowDefs,
  Callout,
  DefTable,
  DocCards,
  DocSection,
  Figure,
  Pill,
  Prose,
  Steps,
} from "../parts";

export const metadata = { title: "Self service" };

export default async function SelfServiceDocsPage() {
  await requirePermission("docs.read");

  return (
    <>
      <PageHeader
        title="Self service"
        description="My Desk — what is on it, what you can do from it, and who can see what."
      />

      <div className="flex flex-col gap-8">
        <DocSection title="What My Desk is">
          <Prose>
            <p>
              <strong>My Desk</strong> is your own corner of the system. Everything on it is your
              record: your attendance, your leave balances, your profile, the notices addressed to
              you. It is the first item in the menu because for most people it is the only part of
              the product they need.
            </p>
            <p>
              Everyone has one — an administrator, an HR manager and a machine operator all open the
              same five screens. What differs is whose record appears, and that is decided by who
              you are signed in as, never by anything in the address bar.
            </p>
          </Prose>

          <div className="mt-4">
            <DocCards
              items={[
                {
                  href: "/me",
                  icon: "LayoutDashboard",
                  title: "My Desk",
                  body: "Today's status, what needs doing, balances, notices and what is coming.",
                },
                {
                  href: "/me/profile",
                  icon: "IdCard",
                  title: "My Profile",
                  body: "Your record, service history, family, qualifications and documents.",
                },
                {
                  href: "/me/calendar",
                  icon: "CalendarRange",
                  title: "My Calendar",
                  body: "A Bikram Sambat month of your own days, with a request one click away.",
                },
                {
                  href: "/me/notices",
                  icon: "Megaphone",
                  title: "Notices",
                  body: "Announcements for you, your branch or your department.",
                },
                {
                  href: "/me/directory",
                  icon: "Contact",
                  title: "Staff Directory",
                  body: "Who to contact and where they sit. Work details only.",
                },
              ]}
            />
          </div>
        </DocSection>

        <DocSection
          title="Doing the four common things"
          lead="All four start from the buttons across the top of My Desk."
        >
          <Steps
            items={[
              {
                title: "Apply for leave",
                body: (
                  <>
                    <strong>Apply for leave</strong> shows the types you are entitled to and the
                    balance on each, so you can see what a request will cost before you make it. The
                    days are held as soon as you submit — that is why your available figure drops
                    before anybody has approved anything.
                  </>
                ),
              },
              {
                title: "Fix a punch",
                body: (
                  <>
                    <strong>Fix my attendance</strong> raises a correction against a specific day.
                    From <strong>My Calendar</strong> you can click the day itself and the date is
                    filled in for you, which is the step people most often get wrong.
                  </>
                ),
              },
              {
                title: "Check where you stand",
                body: (
                  <>
                    The tiles on My Desk cover the last thirty days: days at work, late arrivals and
                    overtime. The donut beneath them is the same period as a proportion — useful
                    when you are asked what your attendance looks like and would rather not count.
                  </>
                ),
              },
              {
                title: "Read your notices",
                body: (
                  <>
                    Unread notices appear at the top of My Desk and on the board. Marking one read
                    is a deliberate click, not something that happens as the page scrolls past —
                    for a safety notice, HR needs to know you actually saw it.
                  </>
                ),
              },
            ]}
          />
        </DocSection>

        <DocSection
          title="Who can see what"
          lead="Two separate controls, and both must pass before any screen opens."
        >
          <Figure caption="Permission answers whether the role gets a desk. Ownership answers whose desk it is. Neither substitutes for the other.">
            <svg viewBox="0 0 820 220" width="820" height="220" role="img" aria-label="Self service access control">
              <ArrowDefs />

              <Pill x={10} y={80} w={150} h={44} label="Signed-in user" sub="session cookie" tone="accent" />
              <Pill x={230} y={20} w={180} h={48} label="RBAC" sub="self.profile.view etc." />
              <Pill x={230} y={130} w={180} h={48} label="Ownership" sub="employeeId from session" tone="warn" />
              <Pill x={490} y={80} w={160} h={44} label="requireSelf()" sub="both, or 403" tone="accent" />
              <Pill x={700} y={80} w={110} h={44} label="Your record" />

              <Arrow from={[160, 92]} to={[226, 50]} />
              <Arrow from={[160, 112]} to={[226, 158]} />
              <Arrow from={[412, 52]} to={[486, 92]} />
              <Arrow from={[412, 158]} to={[486, 112]} />
              <Arrow from={[652, 102]} to={[696, 102]} />

              <text x={10} y={200} fill="var(--color-ink-faint)" fontSize="10">
                There is no employee id in any self-service URL, so there is nothing to change.
              </text>
            </svg>
          </Figure>

          <div className="mt-4">
            <Callout tone="warn" title="What went wrong in the system this replaces">
              The legacy self-service module exposed about fifty API actions that took the employee
              id as a query parameter, and checked it on none of them. Editing{" "}
              <code className="font-mono text-xs">?empId=</code> in the address bar returned another
              person&rsquo;s payslips, documents and family details. Here the id is read from the
              session inside one guard, and every query in the module goes through it.
            </Callout>
          </div>

          <div className="mt-4">
            <DefTable
              rows={[
                [
                  "self.desk.view",
                  "Opens My Desk and My Calendar. Held by every role — a desk is not a privilege.",
                ],
                [
                  "self.profile.view",
                  "Opens My Profile, including the documents HR has shared with you.",
                ],
                ["self.directory.view", "Opens the staff directory."],
                ["self.notice.read", "Opens the notice board and lets you mark a notice read."],
                [
                  "No employee record",
                  "A login not linked to an employee — an administrator, an integration account — has no desk, and gets a plain 403 rather than five empty screens.",
                ],
              ]}
            />
          </div>
        </DocSection>

        <DocSection title="What is deliberately not here">
          <Prose>
            <p>
              <strong>My Profile is read-only.</strong> A screen where somebody edits their own bank
              account, PAN or date of joining is a fraud surface; those go through HR, where the
              change is recorded with who made it. Details you may correct — contact number, family,
              qualifications — are handled as a request, alongside the other requests, rather than
              as a form that silently rewrites your record.
            </p>
            <p>
              <strong>Statutory numbers are masked.</strong> PAN, citizenship, SSF, provident fund
              and your bank account show the last four characters — enough to confirm the number on
              file is yours, not enough to be copied off your screen by somebody walking past.
            </p>
            <p>
              <strong>The directory is narrow.</strong> Name, code, role, placement, work email and
              work mobile. No dates of birth, no home addresses, no salary. A staff list carrying
              those is the easiest personnel-data leak in any HR system, and the previous one
              carried all three.
            </p>
            <p>
              <strong>Some documents are not shown.</strong> Each document on your file is marked
              visible to you or not when it is filed. An investigation note or an internal reference
              stays with HR; the filter is applied in the service, so it holds on every screen that
              ever reads documents rather than on the ones somebody remembered.
            </p>
          </Prose>
        </DocSection>

        <DocSection title="If something looks wrong">
          <DefTable
            rows={[
              [
                "A day is missing a punch",
                "Raise a correction from My Calendar — click the day. Once approved, the day is recalculated immediately.",
              ],
              [
                "Your balance looks short",
                "Check the reserved figure: days held by a request nobody has decided yet are already out of your available balance.",
              ],
              [
                "“Reports to” is empty",
                "Tell HR. Approvals route along the reporting line, so a request from somebody with no supervisor has nowhere to go.",
              ],
              [
                "A document has expired",
                "My Profile warns three months ahead. Send the replacement to HR; you cannot upload it yourself, by design.",
              ],
              [
                "The desk will not open at all",
                "Your login is probably not linked to an employee record. HR links it from Administration › Users.",
              ],
            ]}
          />
        </DocSection>
      </div>
    </>
  );
}
