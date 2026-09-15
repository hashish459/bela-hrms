import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { shifts } from "@/db/schema/attendance";
import { requirePermission } from "@/lib/session";
import { formatDuration } from "@/lib/attendance";
import { Badge, Card, CardHeader, PageHeader, TableShell, Td, Th, Tr } from "@/components/ui";
import { ShiftForm } from "./shift-form";

export const metadata = { title: "Shift master" };

const hhmm = (t: string) => t.slice(0, 5);

export default async function ShiftsPage() {
  const viewer = await requirePermission("attendance.shift.manage");

  const rows = await db
    .select({
      id: shifts.id,
      code: shifts.code,
      name: shifts.name,
      nameNepali: shifts.nameNepali,
      startTime: shifts.startTime,
      endTime: shifts.endTime,
      breakMinutes: shifts.breakMinutes,
      graceInMinutes: shifts.graceInMinutes,
      graceOutMinutes: shifts.graceOutMinutes,
      fullDayMinutes: shifts.fullDayMinutes,
      halfDayMinutes: shifts.halfDayMinutes,
      otAfterMinutes: shifts.otAfterMinutes,
      isNightShift: shifts.isNightShift,
      isDefault: shifts.isDefault,
      isActive: shifts.isActive,
      colour: shifts.colour,
      assigned: sql<number>`(
        select count(*)::int from shift_assignments sa
        where sa.shift_id = ${shifts.id} and sa.effective_to is null
      )`,
    })
    .from(shifts)
    .where(eq(shifts.orgId, viewer.orgId))
    .orderBy(asc(shifts.code));

  return (
    <>
      <PageHeader
        title="Shift master"
        description="The pattern attendance is judged against: when the day starts, how long counts as full, and when overtime begins."
      />

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Card>
          <CardHeader title="Shifts" description={`${rows.length} defined`} />
          <TableShell>
            <thead>
              <tr>
                <Th>Code</Th>
                <Th>Shift</Th>
                <Th>Window</Th>
                <Th className="text-right">Break</Th>
                <Th className="text-right">Grace</Th>
                <Th className="text-right">Full day</Th>
                <Th className="text-right">OT after</Th>
                <Th className="text-right">On roster</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <Tr key={s.id}>
                  <Td>
                    <span className="flex items-center gap-1.5">
                      <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ background: s.colour }}
                        aria-hidden
                      />
                      <span className="font-mono text-xs text-ink-soft">{s.code}</span>
                    </span>
                  </Td>
                  <Td>
                    <span className="block font-medium text-ink">{s.name}</span>
                    {s.nameNepali ? (
                      <span className="block text-xs text-ink-faint">{s.nameNepali}</span>
                    ) : null}
                  </Td>
                  <Td className="tabular whitespace-nowrap">
                    {hhmm(s.startTime)} – {hhmm(s.endTime)}
                    {s.isNightShift ? (
                      <Badge tone="info" className="ml-1.5">
                        night
                      </Badge>
                    ) : null}
                  </Td>
                  <Td className="tabular text-right text-ink-soft">{s.breakMinutes}m</Td>
                  <Td className="tabular text-right text-ink-soft">
                    {s.graceInMinutes}/{s.graceOutMinutes}m
                  </Td>
                  <Td className="tabular text-right text-ink-soft">
                    {formatDuration(s.fullDayMinutes)}
                    <span className="block text-[11px] text-ink-faint">
                      half {formatDuration(s.halfDayMinutes)}
                    </span>
                  </Td>
                  <Td className="tabular text-right text-ink-soft">+{s.otAfterMinutes}m</Td>
                  <Td className="tabular text-right">{s.assigned}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      <Badge tone={s.isActive ? "ok" : "neutral"}>
                        {s.isActive ? "Active" : "Inactive"}
                      </Badge>
                      {s.isDefault ? <Badge tone="accent">Default</Badge> : null}
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableShell>
        </Card>

        <ShiftForm />
      </div>
    </>
  );
}
