import { requirePermission } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import { Arrow, ArrowDefs, Callout, DefTable, DocSection, Figure, Pill, Prose } from "../parts";

export const metadata = { title: "Architecture" };

export default async function ArchitecturePage() {
  await requirePermission("docs.read");

  return (
    <>
      <PageHeader
        title="Architecture"
        description="The stack, what happens on a request, and where the rules live."
      />

      <div className="flex flex-col gap-8">
        <DocSection title="The stack">
          <DefTable
            rows={[
              ["Runtime", "Node 20, Next.js 16 (App Router), React 19, TypeScript 5"],
              ["Rendering", "Server Components read the database directly; Server Actions write to it"],
              ["Data", "PostgreSQL via Drizzle ORM — SQL-shaped and fully typed"],
              ["Auth", "Better Auth (email + password sessions); application identity is separate"],
              ["Validation", "Zod, at the server-action boundary"],
              ["Styling", "Tailwind CSS 4 over CSS custom properties, so themes are token swaps"],
              [
                "Not used",
                "No REST or GraphQL layer, no client state manager, no component library — there is no cache to invalidate and no DTO to keep aligned",
              ],
            ]}
          />
        </DocSection>

        <DocSection
          title="What happens on a request"
          lead="A page render and a mutation take different paths through the same guard."
        >
          <Figure caption="Request path. The permission guard is the only entry point to protected data, and both paths go through it.">
            <svg viewBox="0 0 820 300" width="820" height="300" role="img" aria-label="Request path diagram">
              <ArrowDefs />

              <Pill x={10} y={30} w={130} label="Browser" sub="React 19" />
              <Pill x={10} y={190} w={130} label="Server Action" sub="form submit" tone="sunk" />

              <Pill x={200} y={30} w={150} label="Server Component" sub="app/(app)/…/page.tsx" />
              <Pill x={200} y={190} w={150} label="Zod schema" sub="validate input" tone="sunk" />

              <Pill x={410} y={110} w={150} h={44} label="requirePermission" sub="lib/session.ts" tone="accent" />

              <Pill x={620} y={30} w={180} label="Domain service" sub="lib/leave · lib/attendance" />
              <Pill x={620} y={110} w={180} label="Drizzle query" sub="typed SQL" />
              <Pill x={620} y={190} w={180} label="PostgreSQL" sub="constraints + transactions" tone="sunk" />

              <Arrow from={[140, 47]} to={[198, 47]} label="navigate" />
              <Arrow from={[140, 207]} to={[198, 207]} label="submit" />
              <Arrow from={[350, 47]} to={[408, 122]} />
              <Arrow from={[350, 207]} to={[408, 142]} />
              <Arrow from={[560, 125]} to={[618, 55]} label="mutate" />
              <Arrow from={[560, 132]} to={[618, 125]} label="read" />
              <Arrow from={[710, 74]} to={[710, 105]} />
              <Arrow from={[710, 154]} to={[710, 185]} />

              <text x={415} y={185} fill="var(--color-ink-faint)" fontSize="9.5">
                page → forbidden() 403
              </text>
              <text x={415} y={198} fill="var(--color-ink-faint)" fontSize="9.5">
                action → throws
              </text>

              <text x={10} y={278} fill="var(--color-ink-faint)" fontSize="10">
                No API layer sits between the component and the database — the component is the
                endpoint.
              </text>
            </svg>
          </Figure>
        </DocSection>

        <DocSection title="Where the rules live">
          <Prose>
            <p>
              Business rules are in <code className="font-mono text-xs">src/lib/</code>, not in the
              pages. A page decides what to show; a service decides what is allowed and what it
              means.
            </p>
          </Prose>
          <div className="mt-3">
            <DefTable
              rows={[
                [
                  "lib/session.ts",
                  "Resolves the viewer once per request and answers “may they”. On a page it raises a real 403; in an action it throws, because a mutation must abort rather than half-apply.",
                ],
                [
                  "lib/leave.ts",
                  "Entitlement, overlap, notice periods, the approval chain, and the balance arithmetic — all inside one transaction per submission or decision.",
                ],
                [
                  "lib/attendance/calc.ts",
                  "Pure. Turns two punches and a shift into worked minutes, lateness, overtime and a status. No database import, so the seed generator and the app compute identically.",
                ],
                [
                  "lib/attendance/index.ts",
                  "The database side: shift resolution, the month sheet, and the correction workflow.",
                ],
                [
                  "lib/bs/",
                  "Bikram Sambat conversion against the published calendar table, extracted from the legacy application so dates agree with everything it ever stored.",
                ],
                [
                  "modules/registry.ts",
                  "Navigation and the permission catalogue. Code, not rows — see below.",
                ],
              ]}
            />
          </div>
        </DocSection>

        <DocSection
          title="Why the menu is code"
          lead="The single most important structural decision here, and it is a direct response to how the previous system failed."
        >
          <Callout tone="warn" title="What went wrong before">
            The legacy HRIS kept its whole menu tree in the database. The shipped code moved on and
            the rows did not: a menu item ended up pointing at a parent that no longer existed, the
            tree could not be walked, and <strong>every permission check in the product began
            returning “denied”</strong> — with no error anywhere saying why.
          </Callout>
          <div className="mt-3">
            <Prose>
              <p>
                Here the tree and the catalogue of permissions ship with the build, so they cannot
                drift from it. The database stores only <em>grants</em> — which role holds which
                permission string.
              </p>
              <p>
                A grant for a permission the build no longer defines is ignored at check time
                rather than fatal, and <strong>Administration › Roles</strong> lists any such rows
                so they can be cleaned up.
              </p>
            </Prose>
          </div>

          <div className="mt-4">
            <Figure caption="Permission resolution. Only the grant table is data; everything else is compiled in.">
              <svg viewBox="0 0 780 190" width="780" height="190" role="img" aria-label="Permission resolution diagram">
                <ArrowDefs />
                <Pill x={10} y={20} w={160} label="registry.ts" sub="modules · nav · permissions" tone="accent" />
                <Pill x={10} y={120} w={160} label="role_grants" sub="database rows" tone="sunk" />
                <Pill x={230} y={70} w={150} label="getViewer()" sub="per request, cached" />
                <Pill x={440} y={20} w={150} label="Sidebar" sub="visibleNavigation()" />
                <Pill x={440} y={120} w={150} label="requirePermission" sub="every page + action" />
                <Pill x={640} y={70} w={120} label="Screen" tone="accent" />

                <Arrow from={[170, 37]} to={[228, 80]} label="known keys" />
                <Arrow from={[170, 137]} to={[228, 95]} label="granted" />
                <Arrow from={[380, 80]} to={[438, 40]} />
                <Arrow from={[380, 95]} to={[438, 135]} />
                <Arrow from={[590, 37]} to={[648, 80]} />
                <Arrow from={[590, 137]} to={[648, 95]} />

                <text x={10} y={175} fill="var(--color-ink-faint)" fontSize="10">
                  An unknown grant is dropped here, not followed — a stale row cannot take the menu down.
                </text>
              </svg>
            </Figure>
          </div>
        </DocSection>

        <DocSection title="Multi-tenancy and atomicity">
          <Prose>
            <p>
              One database, many organisations. Tenancy is a column enforced on every query, not a
              separate database per customer chosen by a hostname lookup in a file on disk — which
              is how the previous system did it, and how a tenant could be lost by editing that
              file.
            </p>
            <p>
              Within a tenant, almost every figure is scoped to a fiscal year, and{" "}
              <strong>only one fiscal year can be current</strong>. That is enforced by a partial
              unique index, not by the code that writes it:
            </p>
          </Prose>
          <pre className="mt-3 overflow-x-auto rounded-md border border-line bg-sunk px-3 py-2.5 font-mono text-xs text-ink-soft">
{`CREATE UNIQUE INDEX fiscal_years_one_current_per_org
  ON fiscal_years (org_id) WHERE is_current;`}
          </pre>
          <div className="mt-3">
            <Prose>
              <p>
                Two rows flagged current would make &ldquo;the current year&rdquo; depend on plan
                order — the same query returning a different year on different days. Switching years
                clears the old flag and sets the new one in one transaction, so the index is never
                violated in between.
              </p>
              <p>
                Closed periods work the same way. <strong>Organisation › Fiscal Years</strong> has a
                lock board per module and Bikram Sambat month; locking attendance also stamps every
                day in that month, and both writes are one transaction — a lock row without the
                stamped days would let corrections through against a closed period.
              </p>
            </Prose>
          </div>
        </DocSection>
      </div>
    </>
  );
}
