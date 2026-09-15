import { Mail, Phone, ShieldCheck } from "lucide-react";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { branches, departments } from "@/db/schema/org";
import { directory } from "@/modules/selfservice/desk";
import { requireSelf } from "@/modules/selfservice/guard";
import { offsetPage, sliceOffsetPage, PAGE_SIZE } from "@/lib/pagination";
import { Badge, Card, PageHeader } from "@/components/ui";
import { OffsetPagination } from "@/components/pagination";
import { Avatar, PanelEmpty } from "../parts";
import { DirectoryFilters } from "./filters";

export const metadata = { title: "Staff directory" };

type Search = { [key: string]: string | string[] | undefined };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? (v[0] ?? "") : (v ?? ""));

/**
 * The staff directory.
 *
 * Deliberately narrow. It carries name, code, role, placement, work email and
 * work mobile — the things a colleague needs to reach somebody — and nothing
 * else. The legacy staff list included date of birth, home address, salary grade
 * and citizenship number, readable by every employee in the company; a directory
 * is the single easiest place to leak a personnel file, and the fix is to not
 * put the file in it.
 */
export default async function DirectoryPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requireSelf("self.directory.view");
  const params = await searchParams;

  const q = one(params.q);
  const departmentId = one(params.dept);
  const branchId = one(params.branch);

  const [people, deptOptions, branchOptions] = await Promise.all([
    directory(ctx, { q, departmentId: departmentId || undefined, branchId: branchId || undefined }),
    db
      .select({ id: departments.id, name: departments.name })
      .from(departments)
      .where(and(eq(departments.orgId, ctx.orgId), eq(departments.isActive, true)))
      .orderBy(asc(departments.name)),
    db
      .select({ id: branches.id, name: branches.name })
      .from(branches)
      .where(and(eq(branches.orgId, ctx.orgId), eq(branches.isActive, true)))
      .orderBy(asc(branches.name)),
  ]);

  const page = offsetPage({
    page: one(params.page),
    total: people.length,
    defaultSize: PAGE_SIZE.comfortable * 2,
  });
  const visible = sliceOffsetPage(people, page);

  return (
    <>
      <PageHeader
        title="Staff directory"
        description="Who to contact, and where they sit. Work contact details only."
      />

      <DirectoryFilters
        departments={deptOptions}
        branches={branchOptions}
        values={{ q, dept: departmentId, branch: branchId }}
        total={people.length}
      />

      {people.length === 0 ? (
        <Card className="mt-4">
          <PanelEmpty>Nobody matches those filters.</PanelEmpty>
        </Card>
      ) : (
        <>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((p) => (
              <li key={p.id}>
                <Card
                  className={`flex h-full gap-3 p-3.5 ${
                    p.isMe ? "border-accent bg-accent-soft/40" : ""
                  }`}
                >
                  <Avatar name={p.name} photoUrl={p.photoUrl} size={42} />

                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-semibold text-ink">{p.name}</span>
                      {p.isMe ? <Badge tone="accent">you</Badge> : null}
                    </p>
                    {p.nameNepali ? (
                      <p className="truncate text-[11px] text-ink-faint">{p.nameNepali}</p>
                    ) : null}

                    <p className="mt-1 truncate text-xs text-ink-soft">{p.designation ?? "—"}</p>
                    <p className="truncate text-[11px] text-ink-faint">
                      {[p.department, p.branch].filter(Boolean).join(" · ") || "—"}
                    </p>

                    <div className="mt-2 flex flex-col gap-1">
                      {p.workEmail ? (
                        <a
                          href={`mailto:${p.workEmail}`}
                          className="flex items-center gap-1.5 truncate text-[11px] text-ink-soft hover:text-accent"
                        >
                          <Mail className="size-3 shrink-0" aria-hidden />
                          <span className="truncate">{p.workEmail}</span>
                        </a>
                      ) : null}
                      {p.mobile ? (
                        <a
                          href={`tel:${p.mobile}`}
                          className="tabular flex items-center gap-1.5 text-[11px] text-ink-soft hover:text-accent"
                        >
                          <Phone className="size-3 shrink-0" aria-hidden />
                          {p.mobile}
                        </a>
                      ) : null}
                    </div>
                  </div>

                  <span className="font-mono text-[10px] text-ink-faint">{p.code}</span>
                </Card>
              </li>
            ))}
          </ul>

          <div className="mt-3 overflow-hidden rounded-md border border-line bg-surface">
            <OffsetPagination page={page} params={params} label="colleagues" className="border-t-0" />
          </div>
        </>
      )}

      <p className="mt-4 flex items-center gap-1.5 text-[11px] text-ink-faint">
        <ShieldCheck className="size-3" aria-hidden />
        Work contact details only. Personal addresses, dates of birth and pay are not shown here to
        anybody.
      </p>
    </>
  );
}
