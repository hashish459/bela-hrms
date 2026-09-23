import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { ArrowLeft, Router } from "lucide-react";
import { db } from "@/db/client";
import { branches } from "@/db/schema/org";
import { designations } from "@/db/schema/org";
import { employees, onStrength } from "@/db/schema/hr";
import { attendanceDevices, deviceEnrolments, devicePunches } from "@/db/schema/devices";
import { can, requirePermission } from "@/lib/session";
import { adToBs, formatBs } from "@/lib/bs";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  TableShell,
  Td,
  Th,
  Tr,
} from "@/components/ui";
import { deviceHealth, HEALTH_LABEL, HEALTH_TONE } from "@/modules/attendance/devices";
import {
  CONNECTION_LABEL,
  DIRECTION_HINT,
  DIRECTION_LABEL,
  KIND_LABEL,
  STATUS_LABEL,
} from "../options";
import { EnrolmentPanel, type EnrolmentRow, type EmployeeOption } from "./enrolment-panel";
import { TokenPanel } from "./token-panel";

export const metadata = { title: "Device" };

/**
 * One reader: what it is, who it recognises, and what it has actually sent.
 *
 * The punch log at the bottom is the part that earns its place. When somebody
 * says "the machine did not record me", this is the only screen that can settle
 * it — either the reading is there and something downstream refused it, or the
 * reading never arrived, and those two have completely different fixes.
 */

const PUNCH_TONE: Record<string, "ok" | "warn" | "danger" | "neutral"> = {
  applied: "ok",
  pending: "neutral",
  unmatched: "warn",
  skipped: "danger",
};

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] tracking-wide text-ink-faint uppercase">{label}</dt>
      <dd className="text-sm text-ink">{value || "—"}</dd>
    </div>
  );
}

export default async function DeviceDetailPage({
  params,
}: PageProps<"/attendance/devices/[id]">) {
  const viewer = await requirePermission("attendance.device.manage");
  const { id } = await params;

  const [row] = await db
    .select({ d: attendanceDevices, branchName: branches.name })
    .from(attendanceDevices)
    .leftJoin(branches, eq(branches.id, attendanceDevices.branchId))
    .where(and(eq(attendanceDevices.id, id), eq(attendanceDevices.orgId, viewer.orgId)))
    .limit(1);

  if (!row) notFound();
  const device = row.d;

  const [enrolments, punches, staff, stats] = await Promise.all([
    db
      .select({
        id: deviceEnrolments.id,
        employeeId: deviceEnrolments.employeeId,
        firstName: employees.firstName,
        lastName: employees.lastName,
        employeeCode: employees.employeeCode,
        photoFileId: employees.photoFileId,
        designation: designations.name,
        enrollNumber: deviceEnrolments.enrollNumber,
        enrolledAt: deviceEnrolments.enrolledAt,
        punchCount: sql<number>`(
          SELECT count(*)::int FROM attendance_device_punches p
          WHERE p.device_id = ${deviceEnrolments.deviceId}
            AND p.employee_id = ${deviceEnrolments.employeeId}
        )`,
      })
      .from(deviceEnrolments)
      .innerJoin(employees, eq(employees.id, deviceEnrolments.employeeId))
      .leftJoin(designations, eq(designations.id, employees.designationId))
      .where(eq(deviceEnrolments.deviceId, id))
      .orderBy(asc(sql`length(${deviceEnrolments.enrollNumber})`), asc(deviceEnrolments.enrollNumber)),

    db
      .select({
        id: devicePunches.id,
        enrollNumber: devicePunches.enrollNumber,
        employeeId: devicePunches.employeeId,
        firstName: employees.firstName,
        lastName: employees.lastName,
        employeeCode: employees.employeeCode,
        punchedAt: devicePunches.punchedAt,
        punchDate: devicePunches.punchDate,
        direction: devicePunches.direction,
        status: devicePunches.status,
        note: devicePunches.note,
      })
      .from(devicePunches)
      .leftJoin(employees, eq(employees.id, devicePunches.employeeId))
      .where(eq(devicePunches.deviceId, id))
      .orderBy(desc(devicePunches.punchedAt))
      .limit(40),

    db
      .select({
        id: employees.id,
        code: employees.employeeCode,
        firstName: employees.firstName,
        lastName: employees.lastName,
      })
      .from(employees)
      .where(
        and(
          eq(employees.orgId, viewer.orgId),
          onStrength(),
          // Somebody already enrolled on this reader cannot be enrolled twice,
          // so they are left out of the picker rather than offered and refused.
          sql`NOT EXISTS (
            SELECT 1 FROM attendance_device_enrolments e
            WHERE e.device_id = ${id} AND e.employee_id = ${employees.id}
          )`,
        ),
      )
      .orderBy(asc(employees.employeeCode)),

    db
      .select({
        total: sql<number>`count(*)::int`,
        applied: sql<number>`count(*) FILTER (WHERE ${devicePunches.status} = 'applied')::int`,
        pending: sql<number>`count(*) FILTER (WHERE ${devicePunches.status} = 'pending')::int`,
        unmatched: sql<number>`count(*) FILTER (WHERE ${devicePunches.status} = 'unmatched')::int`,
        skipped: sql<number>`count(*) FILTER (WHERE ${devicePunches.status} = 'skipped')::int`,
      })
      .from(devicePunches)
      .where(eq(devicePunches.deviceId, id)),
  ]);

  const health = deviceHealth(device);
  const canManage = can(viewer, "attendance.device.manage");
  const counts = stats[0] ?? { total: 0, applied: 0, pending: 0, unmatched: 0, skipped: 0 };

  /*
   * The next free enrolment number, so the common case is one click. Readers
   * number sequentially from 1 and the gaps matter to nobody.
   */
  const used = new Set(enrolments.map((e) => Number(e.enrollNumber)).filter(Number.isFinite));
  let suggested = 1;
  while (used.has(suggested)) suggested += 1;

  // The endpoint has to be shown as the device will actually call it, which
  // means the host this request arrived on — not a value from an env file that
  // is wrong on every deployment but the one it was written for.
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "localhost:3000";
  const proto = headerList.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const baseUrl = `${proto}://${host}`;

  const enrolmentRows: EnrolmentRow[] = enrolments.map((e) => ({
    id: e.id,
    employeeId: e.employeeId,
    employeeName: `${e.firstName} ${e.lastName}`,
    employeeCode: e.employeeCode,
    photoFileId: e.photoFileId,
    designation: e.designation,
    enrollNumber: e.enrollNumber,
    enrolledAt: e.enrolledAt.toISOString().slice(0, 10),
    punchCount: e.punchCount,
  }));

  const options: EmployeeOption[] = staff.map((s) => ({
    id: s.id,
    label: `${s.code} — ${s.firstName} ${s.lastName}`,
  }));

  return (
    <>
      <Link
        href="/attendance/devices"
        className="mb-3 inline-flex items-center gap-1 text-xs text-ink-faint hover:text-ink"
      >
        <ArrowLeft className="size-3.5" />
        Devices
      </Link>

      <PageHeader
        title={device.name}
        description={`${KIND_LABEL[device.kind]} reader · ${CONNECTION_LABEL[device.connection]}`}
        action={
          <span className="flex items-center gap-2">
            <Badge tone={HEALTH_TONE[health]}>{HEALTH_LABEL[health]}</Badge>
            {device.status !== "active" ? (
              <Badge tone="neutral">{STATUS_LABEL[device.status]}</Badge>
            ) : null}
          </span>
        }
      />

      {device.lastError ? (
        <p className="mb-4 rounded-md border border-danger/30 bg-danger-soft/50 px-3 py-2 text-sm text-danger">
          Last sync reported: {device.lastError}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader
              title="Configuration"
              action={
                <span className="flex items-center gap-1.5 text-xs text-ink-faint">
                  <Router className="size-3.5" />
                  <span className="font-mono">{device.code}</span>
                </span>
              }
            />
            <dl className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-3">
              <Detail label="Branch" value={row.branchName} />
              <Detail label="Location" value={device.location} />
              <Detail label="Reads" value={KIND_LABEL[device.kind]} />
              <Detail
                label="Counts punches as"
                value={
                  <span>
                    {DIRECTION_LABEL[device.direction]}
                    <span className="mt-0.5 block text-[11px] text-ink-faint">
                      {DIRECTION_HINT[device.direction]}
                    </span>
                  </span>
                }
              />
              <Detail label="Connection" value={CONNECTION_LABEL[device.connection]} />
              <Detail
                label="Address"
                value={
                  device.ipAddress ? (
                    <span className="font-mono text-xs">
                      {device.ipAddress}
                      {device.port ? `:${device.port}` : ""}
                    </span>
                  ) : null
                }
              />
              <Detail label="Vendor" value={[device.vendor, device.model].filter(Boolean).join(" ")} />
              <Detail
                label="Serial"
                value={<span className="font-mono text-xs">{device.serialNumber}</span>}
              />
              <Detail label="Expected every" value={`${device.syncIntervalMinutes} min`} />
              <Detail
                label="Last contact"
                value={device.lastSeenAt ? device.lastSeenAt.toLocaleString() : null}
              />
              <Detail
                label="Last processed"
                value={device.lastSyncAt ? device.lastSyncAt.toLocaleString() : null}
              />
              {device.notes ? <Detail label="Notes" value={device.notes} /> : null}
            </dl>
          </Card>

          <Card>
            <EnrolmentPanel
              deviceId={id}
              rows={enrolmentRows}
              options={options}
              suggestedNumber={String(suggested)}
              canManage={canManage}
            />
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <TokenPanel
              deviceId={id}
              deviceCode={device.code}
              prefix={device.apiKeyPrefix}
              issuedAt={
                device.apiKeyIssuedAt
                  ? formatBs(adToBs(device.apiKeyIssuedAt.toISOString().slice(0, 10)))
                  : null
              }
              baseUrl={baseUrl}
            />
          </Card>

          <Card>
            <CardHeader title="Punch log" description={`${counts.total} readings on file`} />
            <ul className="grid grid-cols-2 gap-2 border-b border-line-soft p-4 sm:grid-cols-4">
              {(
                [
                  ["Applied", counts.applied, "ok"],
                  ["Waiting", counts.pending, "neutral"],
                  ["Unmatched", counts.unmatched, "warn"],
                  ["Left alone", counts.skipped, "danger"],
                ] as const
              ).map(([label, value, tone]) => (
                <li key={label}>
                  <p className="text-[11px] text-ink-faint">{label}</p>
                  <p className="tabular mt-0.5 text-lg leading-none font-semibold text-ink">
                    {value}
                  </p>
                  {value > 0 && tone !== "neutral" && tone !== "ok" ? (
                    <Badge tone={tone} className="mt-1">
                      needs a look
                    </Badge>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <Card className="mt-4">
        <CardHeader
          title="Recent readings"
          description="Newest first. What the reader sent, and what became of it."
        />
        {punches.length === 0 ? (
          <EmptyState
            title="Nothing received yet"
            hint="Once the device posts readings they appear here, matched or not."
          />
        ) : (
          <TableShell>
            <thead>
              <tr>
                <Th>Time</Th>
                <Th>Attendance day</Th>
                <Th className="w-20">Number</Th>
                <Th>Employee</Th>
                <Th>Direction</Th>
                <Th>Outcome</Th>
              </tr>
            </thead>
            <tbody>
              {punches.map((p) => (
                <Tr key={p.id}>
                  <Td className="tabular text-sm text-ink">
                    {p.punchedAt.toTimeString().slice(0, 8)}
                  </Td>
                  <Td className="tabular text-ink-soft">
                    <span className="block text-sm">{formatBs(adToBs(p.punchDate))}</span>
                    <span className="block text-[11px] text-ink-faint">{p.punchDate}</span>
                  </Td>
                  <Td className="font-mono text-sm text-ink-soft">#{p.enrollNumber}</Td>
                  <Td>
                    {p.employeeId ? (
                      <Link
                        href={`/hr/employees/${p.employeeId}`}
                        className="text-sm text-ink hover:text-accent"
                      >
                        {p.firstName} {p.lastName}
                        <span className="ml-1.5 font-mono text-[11px] text-ink-faint">
                          {p.employeeCode}
                        </span>
                      </Link>
                    ) : (
                      <span className="text-sm text-warn">nobody is enrolled as this</span>
                    )}
                  </Td>
                  <Td className="text-ink-soft capitalize">{p.direction}</Td>
                  <Td>
                    <Badge tone={PUNCH_TONE[p.status] ?? "neutral"}>{p.status}</Badge>
                    {p.note ? (
                      <span
                        className="mt-0.5 block max-w-64 truncate text-[11px] text-ink-faint"
                        title={p.note}
                      >
                        {p.note}
                      </span>
                    ) : null}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </Card>
    </>
  );
}
