import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { fiscalYears, periodLocks } from "@/db/schema/core";
import { requirePermission } from "@/lib/session";
import { adToBs, todayInNepal } from "@/lib/bs";
import { Badge, Card, PageHeader, TableShell, Td, Th, Tr } from "@/components/ui";
import { MakeCurrentButton, NewFiscalYearForm, PeriodLockBoard } from "./forms";

export const metadata = { title: "Fiscal years" };

const ad = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

export default async function FiscalYearsPage() {
  const viewer = await requirePermission("setup.fiscalYear.manage");

  const [rows, locks] = await Promise.all([
    db
      .select()
      .from(fiscalYears)
      .where(eq(fiscalYears.orgId, viewer.orgId))
      .orderBy(desc(fiscalYears.startDate)),
    db.select().from(periodLocks).where(eq(periodLocks.orgId, viewer.orgId)),
  ]);

  const current = rows.find((r) => r.isCurrent) ?? null;
  const currentLocks = new Set(
    locks
      .filter((l) => l.fiscalYearId === current?.id && l.bsMonth !== null)
      .map((l) => `${l.module}:${l.bsMonth}`),
  );

  // next year that does not exist yet
  const nowBs = adToBs(todayInNepal());
  const thisFyStart = nowBs.month >= 4 ? nowBs.year : nowBs.year - 1;
  const defined = new Set(rows.map((r) => Number(r.code.split("/")[0])));
  let suggested = thisFyStart;
  while (defined.has(suggested)) suggested++;

  const lockCount = (fyId: string) => locks.filter((l) => l.fiscalYearId === fyId).length;

  return (
    <>
      <PageHeader
        title="Fiscal years"
        description="Shrawan 1 to Ashadh end. Every leave balance, attendance total and report is scoped to one."
      />

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <div className="flex flex-col gap-4">
          <TableShell>
            <thead>
              <tr>
                <Th>Year</Th>
                <Th>Starts (BS)</Th>
                <Th>Ends (BS)</Th>
                <Th>Gregorian</Th>
                <Th className="text-right">Locks</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    <span className="flex items-center gap-2">
                      <span className="tabular font-medium text-ink">{r.code}</span>
                      {r.isCurrent ? <Badge tone="accent">Current</Badge> : null}
                      {r.isClosed ? <Badge tone="neutral">Closed</Badge> : null}
                    </span>
                  </Td>
                  <Td className="tabular text-ink-soft">{r.startDateBs}</Td>
                  <Td className="tabular text-ink-soft">{r.endDateBs}</Td>
                  <Td className="tabular text-xs text-ink-faint">
                    {ad(r.startDate)} – {ad(r.endDate)}
                  </Td>
                  <Td className="tabular text-right text-ink-soft">{lockCount(r.id) || "—"}</Td>
                  <Td className="text-right">
                    {!r.isCurrent && !r.isClosed ? (
                      <MakeCurrentButton id={r.id} />
                    ) : null}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableShell>

          {current ? (
            <PeriodLockBoard
              fiscalYearId={current.id}
              code={current.code}
              locked={currentLocks}
            />
          ) : (
            <Card>
              <p className="px-4 py-6 text-center text-sm text-ink-soft">
                No fiscal year is current, so period locking has nothing to apply to.
              </p>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <NewFiscalYearForm suggestedYear={suggested} />

          <Card>
            <div className="flex flex-col gap-2 p-4 text-xs text-ink-soft">
              <p className="text-sm font-semibold text-ink">Why only one current year</p>
              <p>
                Every request resolves &ldquo;the current fiscal year&rdquo; to scope balances and
                reports. Two rows flagged current would make that resolution depend on plan order —
                the same query returning a different year on different days.
              </p>
              <p>
                A partial unique index on{" "}
                <code className="font-mono text-[11px]">org_id WHERE is_current</code> makes it
                impossible in the database, not just in the code that writes it. Switching years
                clears the old flag and sets the new one in a single transaction.
              </p>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
