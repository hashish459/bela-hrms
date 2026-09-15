import { requirePermission } from "@/lib/session";
import { APP } from "@/lib/branding";
import { deliveryProgress } from "@/modules/registry";
import { PageHeader, StatTile } from "@/components/ui";
import { BarChart, Callout, DocCards, DocSection, Prose, Steps } from "./parts";

export const metadata = { title: "Getting started" };

export default async function DocsHomePage() {
  const viewer = await requirePermission("docs.read");
  const progress = deliveryProgress();

  const built = progress.modules
    .filter((m) => m.ready > 0)
    .map((m) => ({ label: m.label, value: m.ready, tone: "accent" as const }));
  const planned = progress.modules
    .filter((m) => m.ready === 0)
    .map((m) => ({ label: m.label, value: m.total, tone: "warn" as const }));

  return (
    <>
      <PageHeader
        title="Getting started"
        description={`${APP.fullName} — what it does, how it is put together, and how to use it.`}
      />

      <div className="flex flex-col gap-8">
        <DocSection title="What this is">
          <Prose>
            <p>
              {APP.name} runs the people side of {APP.company}: who works here, when they were at
              work, and the leave they take. It replaces the Nimble.Ananta HRIS, and is built to
              grow one module at a time — payroll, appraisal, training and the rest are already
              laid out in the menu with their routes and permissions fixed.
            </p>
            <p>
              Everything is scoped to an <strong>organisation</strong> and a{" "}
              <strong>fiscal year</strong>. Nepali fiscal years run Shrawan 1 to Ashadh end, and
              dates are entered and shown in Bikram Sambat while being stored Gregorian.
            </p>
          </Prose>
        </DocSection>

        <DocSection title="Find your way around">
          <DocCards
            items={[
              {
                href: "/docs/manual",
                icon: "BookOpen",
                title: "User Manual",
                body: "Step by step for each thing you might need to do, by role.",
              },
              {
                href: "/docs/faq",
                icon: "MessagesSquare",
                title: "FAQ",
                body: "The questions people actually ask — balances, lateness, locked periods.",
              },
              {
                href: "/docs/workflows",
                icon: "GitBranch",
                title: "Workflows",
                body: "How a leave request or an attendance correction moves, with diagrams.",
              },
              {
                href: "/docs/architecture",
                icon: "Network",
                title: "Architecture",
                body: "The stack, the request path, and where the rules live.",
              },
              {
                href: "/docs/data-model",
                icon: "Database",
                title: "Data Model",
                body: "Tables, relationships and the invariants the database enforces.",
              },
              {
                href: "/docs/roadmap",
                icon: "Milestone",
                title: "Roadmap",
                body: "What is built, what is planned, and how a module gets added.",
              },
            ]}
          />
        </DocSection>

        <DocSection
          title="Where the product is"
          lead="Screens marked “soon” in the menu are real routes that explain what will live there."
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <StatTile label="Screens built" value={progress.ready} tone="ok" />
            <StatTile label="Screens planned" value={progress.planned} tone="warn" />
            <StatTile
              label="Modules"
              value={progress.modules.length}
              sub={`${progress.modules.filter((m) => m.ready > 0).length} with working screens`}
            />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-md border border-line bg-surface p-4">
              <p className="mb-3 text-sm font-medium text-ink">Built screens by module</p>
              <BarChart data={built} />
            </div>
            <div className="rounded-md border border-line bg-surface p-4">
              <p className="mb-3 text-sm font-medium text-ink">Planned screens by module</p>
              <BarChart data={planned} />
            </div>
          </div>
        </DocSection>

        <DocSection title="Your first five minutes">
          <Steps
            items={[
              {
                title: "Check the header",
                body: (
                  <>
                    Today&apos;s date in both calendars, the current fiscal year, and who you are
                    signed in as. If the fiscal year is wrong, everything scoped to it will be too.
                  </>
                ),
              },
              {
                title: "Open the module you need",
                body: (
                  <>
                    Click a module in the sidebar to open its screens; the one you are in opens
                    itself. Press <kbd className="rounded border border-line px-1 font-mono text-[11px]">/</kbd>{" "}
                    to search every screen by name instead.
                  </>
                ),
              },
              {
                title: "Raise something",
                body: (
                  <>
                    Leave goes through <strong>Leave › My Leave</strong>; a wrong punch through{" "}
                    <strong>Attendance › My Requests</strong>. Both route to your supervisor
                    automatically.
                  </>
                ),
              },
              {
                title: "Set the app up the way you like it",
                body: (
                  <>
                    <strong>Administration › Appearance</strong> has theme, typeface, text size and
                    density. It is personal to you and this browser.
                  </>
                ),
              },
            ]}
          />
        </DocSection>

        <DocSection title="Signed in as">
          <Callout tone="info" title={`${viewer.name} — ${viewer.roleNames.join(", ") || "no role"}`}>
            You hold {viewer.permissions.size} permissions, which is why your menu looks the way it
            does. Another role sees a different tree entirely. Roles and their permissions are at{" "}
            <strong>Administration › Roles</strong>.
          </Callout>
        </DocSection>
      </div>
    </>
  );
}
