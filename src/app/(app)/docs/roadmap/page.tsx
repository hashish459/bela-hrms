import * as Icons from "lucide-react";
import { requirePermission } from "@/lib/session";
import { MODULES, deliveryProgress } from "@/modules/registry";
import { Badge, Card, PageHeader, StatTile } from "@/components/ui";
import { BarChart, Callout, DocSection, Prose, Steps } from "../parts";

export const metadata = { title: "Roadmap" };

export default async function RoadmapPage() {
  await requirePermission("docs.read");

  const progress = deliveryProgress();
  const total = progress.ready + progress.planned;
  const modules = MODULES.slice().sort((a, b) => a.order - b.order);

  const coverage = progress.modules
    .map((m) => ({
      label: m.label,
      value: m.total === 0 ? 0 : Math.round((m.ready / m.total) * 100),
      tone: (m.ready === m.total ? "ok" : m.ready > 0 ? "accent" : "warn") as
        | "ok"
        | "accent"
        | "warn",
    }))
    .sort((a, b) => b.value - a.value);

  return (
    <>
      <PageHeader
        title="Roadmap"
        description="What is built, what is next, and how a planned screen becomes a real one."
      />

      <div className="flex flex-col gap-8">
        <DocSection
          title="Where the product is"
          lead="Counted from the registry as this page renders, so it cannot go stale."
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Screens built" value={progress.ready} tone="ok" />
            <StatTile label="Screens planned" value={progress.planned} tone="warn" />
            <StatTile label="Modules" value={modules.length} />
            <StatTile
              label="Delivered"
              value={`${total === 0 ? 0 : Math.round((progress.ready / total) * 100)}%`}
              tone="accent"
              sub={`${progress.ready} of ${total} screens`}
            />
          </div>
          <div className="mt-4 rounded-md border border-line bg-surface p-4">
            <p className="mb-3 text-sm font-medium text-ink">Completion by module</p>
            <BarChart data={coverage} max={100} unit="%" />
          </div>
        </DocSection>

        <DocSection
          title="Phase one — shipped"
          lead="The two modules the business runs on daily, built end to end rather than sketched."
        >
          <Prose>
            <p>
              Attendance and leave are complete: shifts, the month sheet, corrections, entitlement,
              balances and the approval chain — with the fiscal year, holidays, period locks, users,
              roles and the audit trail underneath them. Employees and reporting lines are built
              because everything else keys off them.
            </p>
            <p>
              Nothing in this phase is a stub. A screen listed as built reads and writes real data
              and enforces its own permissions.
            </p>
          </Prose>
        </DocSection>

        <DocSection
          title="What is planned, module by module"
          lead="Every planned screen already has its route, its permission and its place in the menu."
        >
          <div className="grid gap-3 lg:grid-cols-2">
            {modules.map((m) => {
              const readyCount = m.nav.filter((n) => n.status === "ready").length;
              const plannedItems = m.nav.filter((n) => n.status === "planned");
              const Icon =
                (Icons as unknown as Record<string, Icons.LucideIcon>)[m.icon] ?? Icons.Square;
              const done = plannedItems.length === 0;

              return (
                <Card key={m.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-2.5">
                      <Icon className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-ink">{m.label}</p>
                        <p className="mt-0.5 text-xs text-ink-soft">{m.summary}</p>
                      </div>
                    </div>
                    <Badge tone={done ? "ok" : readyCount > 0 ? "accent" : "warn"}>
                      {done ? "complete" : `${readyCount}/${m.nav.length}`}
                    </Badge>
                  </div>

                  {plannedItems.length > 0 ? (
                    <ul className="mt-3 flex flex-col gap-2 border-t border-line-soft pt-3">
                      {plannedItems.map((item) => (
                        <li key={item.id}>
                          <p className="text-xs font-medium text-ink">{item.label}</p>
                          <p className="mt-0.5 text-xs text-ink-faint">{item.description}</p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 border-t border-line-soft pt-3 text-xs text-ink-faint">
                      Every screen in this module is built.
                    </p>
                  )}
                </Card>
              );
            })}
          </div>
        </DocSection>

        <DocSection
          title="How a planned screen becomes a real one"
          lead="The same five steps every time, which is why the menu never moves under anybody's feet."
        >
          <Steps
            items={[
              {
                title: "The route already exists",
                body: (
                  <>
                    A planned item is a real route with a real permission. Until it is built, the
                    catch-all page explains what will live there — nothing 404s and nothing is
                    hidden.
                  </>
                ),
              },
              {
                title: "Tables and constraints first",
                body: (
                  <>
                    Schema in <code className="font-mono text-xs">src/db/schema/</code> with the
                    invariants expressed as constraints, then a generated migration. If a rule can
                    be a unique index, it is one.
                  </>
                ),
              },
              {
                title: "The rule lives in a service",
                body: (
                  <>
                    Business logic goes in <code className="font-mono text-xs">src/lib/</code>, not
                    in the page, and anything worth testing without a database goes in a pure module
                    the way the attendance calculation did.
                  </>
                ),
              },
              {
                title: "The screen is a Server Component",
                body: (
                  <>
                    It reads through the service, guards with{" "}
                    <code className="font-mono text-xs">requirePermission</code>, and writes through
                    Server Actions validated with Zod.
                  </>
                ),
              },
              {
                title: "Flip the registry entry",
                body: (
                  <>
                    Change <code className="font-mono text-xs">planned(…)</code> to{" "}
                    <code className="font-mono text-xs">ready(…)</code>. The sidebar, the roadmap and
                    this page all follow from that one line.
                  </>
                ),
              },
            ]}
          />
        </DocSection>

        <DocSection title="Known limits">
          <Callout tone="warn" title="Carried over from the legacy system">
            453 stored procedures in the old database could not be recovered — their definitions
            were never in source control. Where a planned module depended on one, the rule is being
            rewritten from the reports it produced rather than translated, which is slower but
            leaves the logic readable.
          </Callout>
          <div className="mt-3">
            <Prose>
              <p>
                Attendance imports currently arrive as punch data; a live device integration is
                queued behind payroll. Notifications are in the registry but not yet wired to a mail
                transport — approvals appear on the dashboard in the meantime.
              </p>
            </Prose>
          </div>
        </DocSection>
      </div>
    </>
  );
}
