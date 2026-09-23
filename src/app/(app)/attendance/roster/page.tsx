import Link from "next/link";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { employees, onStrength } from "@/db/schema/hr";
import { departments } from "@/db/schema/org";
import { shiftAssignments, shifts } from "@/db/schema/attendance";
import { requirePermission } from "@/lib/session";
import { todayInNepal } from "@/lib/bs";
import { Badge, Card, CardHeader, PageHeader, TableShell, Td, Th, Tr } from "@/components/ui";
import { AssignForm } from "./assign-form";

export const metadata = { title: "Shift assignment" };

export default async function RosterPage() {
  const viewer = await requirePermission("attendance.roster.manage");
  const today = todayInNepal();

  const [staff, shiftOptions, history] = await Promise.all([
    db
      .select({
        id: employees.id,
        code: employees.employeeCode,
        name: sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,
        department: departments.name,
        shiftId: shifts.id,
        shiftCode: shifts.code,
        shiftName: shifts.name,
        shiftColour: shifts.colour,
        shiftWindow: sql<string | null>`${shifts.startTime} || ' – ' || ${shifts.endTime}`,
        effectiveFrom: shiftAssignments.effectiveFrom,
      })
      .from(employees)
      .leftJoin(
        shiftAssignments,
        and(
          eq(shiftAssignments.employeeId, employees.id),
          isNull(shiftAssignments.effectiveTo),
        ),
      )
      .leftJoin(shifts, eq(shifts.id, shiftAssignments.shiftId))
      .leftJoin(departments, eq(departments.id, employees.departmentId))
      .where(
        and(
          eq(employees.orgId, viewer.orgId),
          onStrength(),
        ),
      )
      .orderBy(asc(employees.employeeCode)),

    db
      .select({ id: shifts.id, code: shifts.code, name: shifts.name })
      .from(shifts)
      .where(and(eq(shifts.orgId, viewer.orgId), eq(shifts.isActive, true)))
      .orderBy(asc(shifts.code)),

    db
      .select({
        id: shiftAssignments.id,
        employeeName: sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,
        employeeCode: employees.employeeCode,
        shiftCode: shifts.code,
        effectiveFrom: shiftAssignments.effectiveFrom,
        effectiveTo: shiftAssignments.effectiveTo,
        note: shiftAssignments.note,
        assignedBy: shiftAssignments.assignedBy,
      })
      .from(shiftAssignments)
      .innerJoin(employees, eq(employees.id, shiftAssignments.employeeId))
      .innerJoin(shifts, eq(shifts.id, shiftAssignments.shiftId))
      .where(eq(shiftAssignments.orgId, viewer.orgId))
      .orderBy(desc(shiftAssignments.createdAt))
      .limit(12),
  ]);

  const unassigned = staff.filter((s) => !s.shiftId).length;

  return (
    <>
      <PageHeader
        title="Shift assignment"
        description="Assignments are dated. Moving somebody closes the current row rather than editing it, so attendance already calculated stays explicable."
      />

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Card>
          <CardHeader
            title="Current roster"
            description={
              unassigned > 0
                ? `${unassigned} employee(s) have no shift — the default is used`
                : "Everybody is rostered"
            }
          />
          <TableShell>
            <thead>
              <tr>
                <Th>Code</Th>
                <Th>Employee</Th>
                <Th>Department</Th>
                <Th>Shift</Th>
                <Th>Window</Th>
                <Th>Since</Th>
              </tr>
            </thead>
            <tbody>
              {staff.map((s) => (
                <Tr key={s.id}>
                  <Td className="font-mono text-xs text-ink-soft">{s.code}</Td>
                  <Td>
                    <Link
                      href={`/hr/employees/${s.id}`}
                      className="font-medium text-ink hover:text-accent"
                    >
                      {s.name}
                    </Link>
                  </Td>
                  <Td className="text-ink-soft">{s.department ?? "—"}</Td>
                  <Td>
                    {s.shiftCode ? (
                      <span className="flex items-center gap-1.5">
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{ background: s.shiftColour ?? "#888" }}
                          aria-hidden
                        />
                        {s.shiftName}
                      </span>
                    ) : (
                      <Badge tone="warn">Not assigned</Badge>
                    )}
                  </Td>
                  <Td className="tabular text-xs text-ink-faint">
                    {s.shiftWindow ? s.shiftWindow.replace(/:00/g, "") : "—"}
                  </Td>
                  <Td className="tabular text-xs text-ink-faint">{s.effectiveFrom ?? "—"}</Td>
                </Tr>
              ))}
            </tbody>
          </TableShell>
        </Card>

        <div className="flex flex-col gap-4">
          <AssignForm
            today={today}
            shifts={shiftOptions}
            employees={staff.map((s) => ({
              id: s.id,
              label: `${s.name} (${s.code})`,
              current: s.shiftCode ?? null,
              department: s.department ?? null,
            }))}
          />

          <Card>
            <CardHeader title="Recent changes" description="Twelve most recent" />
            <ul className="divide-y divide-line-soft">
              {history.map((h) => (
                <li key={h.id} className="px-4 py-2">
                  <p className="text-sm text-ink">
                    {h.employeeName}
                    <span className="ml-1.5 font-mono text-[11px] text-ink-faint">
                      {h.employeeCode}
                    </span>
                  </p>
                  <p className="tabular text-[11px] text-ink-faint">
                    {h.shiftCode} · from {h.effectiveFrom}
                    {h.effectiveTo ? ` to ${h.effectiveTo}` : " (current)"}
                    {h.assignedBy ? ` · by ${h.assignedBy}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
