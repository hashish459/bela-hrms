import Link from "next/link";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { AlertTriangle, UserRoundX } from "lucide-react";
import { db } from "@/db/client";
import { branches } from "@/db/schema/org";
import { attendanceDevices, devicePunches } from "@/db/schema/devices";
import { can, requirePermission } from "@/lib/session";
import { todayInNepal } from "@/lib/bs";
import { Card, CardHeader, PageHeader, StatTile } from "@/components/ui";
import {
  deviceDigest,
  deviceHealth,
  HEALTH_LABEL,
  HEALTH_TONE,
} from "@/modules/attendance/devices";
import { DeviceList, type DeviceRow } from "./device-list";

export const metadata = { title: "Devices" };

/**
 * The device register.
 *
 * The legacy system had 27 readers, 924 K processed logs and no way to tell
 * whether any given machine was still alive. A silent reader and a branch where
 * nobody turned up produce exactly the same thing — an empty column in the
 * register — so the first job of this page is to tell those two apart.
 *
 * The second is the unmatched punch: somebody stood at the reader, it read
 * them, and no enrolment says who they are. That is a real person whose day is
 * about to be marked absent, and it is invisible everywhere else in the
 * product.
 */

/** "4 minutes ago", and honest about never. */
function ago(at: Date | null): string {
  if (!at) return "no contact yet";
  const minutes = Math.floor((Date.now() - at.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default async function DevicesPage() {
  const viewer = await requirePermission("attendance.device.manage");
  const today = todayInNepal();

  const [rows, branchOptions, digest, unmatched] = await Promise.all([
    db
      .select({
        d: attendanceDevices,
        branchName: branches.name,
        enrolments: sql<number>`(
          SELECT count(*)::int FROM attendance_device_enrolments e
          WHERE e.device_id = ${attendanceDevices.id}
        )`,
        punchesToday: sql<number>`(
          SELECT count(*)::int FROM attendance_device_punches p
          WHERE p.device_id = ${attendanceDevices.id} AND p.punch_date = ${today}
        )`,
        pendingPunches: sql<number>`(
          SELECT count(*)::int FROM attendance_device_punches p
          WHERE p.device_id = ${attendanceDevices.id} AND p.status = 'pending'
        )`,
        unmatchedPunches: sql<number>`(
          SELECT count(*)::int FROM attendance_device_punches p
          WHERE p.device_id = ${attendanceDevices.id} AND p.status = 'unmatched'
        )`,
      })
      .from(attendanceDevices)
      .leftJoin(branches, eq(branches.id, attendanceDevices.branchId))
      .where(eq(attendanceDevices.orgId, viewer.orgId))
      .orderBy(asc(attendanceDevices.code)),

    db
      .select({ id: branches.id, name: branches.name })
      .from(branches)
      .where(eq(branches.orgId, viewer.orgId))
      .orderBy(asc(branches.name)),

    deviceDigest(viewer.orgId),

    // The punches nobody owns, newest first — the queue somebody has to clear.
    db
      .select({
        id: devicePunches.id,
        deviceId: devicePunches.deviceId,
        deviceCode: attendanceDevices.code,
        enrollNumber: devicePunches.enrollNumber,
        punchedAt: devicePunches.punchedAt,
        punchDate: devicePunches.punchDate,
      })
      .from(devicePunches)
      .innerJoin(attendanceDevices, eq(attendanceDevices.id, devicePunches.deviceId))
      .where(and(eq(devicePunches.orgId, viewer.orgId), eq(devicePunches.status, "unmatched")))
      .orderBy(desc(devicePunches.punchedAt))
      .limit(8),
  ]);

  const now = new Date();

  const list: DeviceRow[] = rows.map((r) => {
    const health = deviceHealth(r.d, now);
    return {
      id: r.d.id,
      code: r.d.code,
      name: r.d.name,
      branchId: r.d.branchId,
      branchName: r.branchName,
      location: r.d.location,
      kind: r.d.kind,
      connection: r.d.connection,
      direction: r.d.direction,
      status: r.d.status,
      vendor: r.d.vendor,
      model: r.d.model,
      serialNumber: r.d.serialNumber,
      ipAddress: r.d.ipAddress,
      port: r.d.port,
      syncIntervalMinutes: r.d.syncIntervalMinutes,
      notes: r.d.notes,
      health,
      healthLabel: HEALTH_LABEL[health],
      healthTone: HEALTH_TONE[health],
      lastSeenLabel: ago(r.d.lastSeenAt),
      enrolments: r.enrolments,
      punchesToday: r.punchesToday,
      pendingPunches: r.pendingPunches,
      unmatchedPunches: r.unmatchedPunches,
      hasToken: Boolean(r.d.apiKeyPrefix),
      lastError: r.d.lastError,
    };
  });

  const notReporting = list.filter((d) => d.health === "silent" || d.health === "stale").length;
  const unenrolled = Math.max(0, digest.headcount - digest.enrolled);

  return (
    <>
      <PageHeader
        title="Devices"
        description="Biometric and card readers, who is enrolled on them, and the raw punches they push."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Readers"
          value={digest.devices}
          sub={`${digest.activeDevices} in service`}
          tone="accent"
        />
        <StatTile
          label="Not reporting"
          value={notReporting}
          sub="late or silent"
          tone={notReporting > 0 ? "danger" : "ok"}
        />
        <StatTile
          label="Punches today"
          value={digest.punchesToday}
          sub={
            digest.punchesPending > 0
              ? `${digest.punchesPending} waiting to be processed`
              : "all processed"
          }
          tone="info"
        />
        <StatTile
          label="Enrolled staff"
          value={`${digest.enrolled} / ${digest.headcount}`}
          sub={unenrolled > 0 ? `${unenrolled} cannot be recognised` : "everyone is enrolled"}
          tone={unenrolled > 0 ? "warn" : "ok"}
        />
      </div>

      {unenrolled > 0 ? (
        <p className="mt-3 flex items-start gap-2 rounded-md border border-warn/30 bg-warn-soft/50 px-3 py-2 text-xs text-ink-soft">
          <UserRoundX className="mt-0.5 size-4 shrink-0 text-warn" />
          <span>
            <strong className="text-ink">{unenrolled}</strong> employees on strength are not
            enrolled on any reader. No machine can recognise them, so their days will fall to
            manual entry or come back absent. Enrol them from a device&rsquo;s page.
          </span>
        </p>
      ) : null}

      {unmatched.length > 0 ? (
        <Card className="mt-4 border-warn/40">
          <CardHeader
            title="Punches nobody owns"
            description="A reader recognised a number that no enrolment claims. Someone was at work and is about to be marked absent."
          />
          <ul className="grid gap-2 p-4 sm:grid-cols-2 xl:grid-cols-4">
            {unmatched.map((p) => (
              <li
                key={p.id}
                className="flex items-start gap-2 rounded border border-line-soft bg-sunk/40 px-3 py-2"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />
                <div className="min-w-0">
                  <p className="font-mono text-sm text-ink">#{p.enrollNumber}</p>
                  <Link
                    href={`/attendance/devices/${p.deviceId}`}
                    className="block truncate text-xs text-ink-soft hover:text-accent"
                  >
                    {p.deviceCode}
                  </Link>
                  <p className="tabular mt-0.5 text-[11px] text-ink-faint">
                    {p.punchDate} · {p.punchedAt.toTimeString().slice(0, 5)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
          <p className="border-t border-line-soft px-4 py-2 text-xs text-ink-faint">
            Enrol that number against an employee and the punches already on file are matched and
            applied automatically — including the days before the enrolment existed.
          </p>
        </Card>
      ) : null}

      <Card className="mt-4">
        <DeviceList
          rows={list}
          branches={branchOptions}
          canManage={can(viewer, "attendance.device.manage")}
        />
      </Card>

      <Card className="mt-4">
        <CardHeader
          title="How punches arrive"
          description="There is no polling from this server, and that is deliberate."
        />
        <div className="flex flex-col gap-2 p-4 text-sm text-ink-soft">
          <p>
            A reader on a factory LAN is not addressable from wherever this application runs, so a
            &ldquo;connect and download&rdquo; button here would be one that quietly never worked.
            Readings are <strong className="text-ink">posted in</strong> instead — by a cloud
            device directly, or by a small agent on the site network that polls the reader and
            forwards what it finds.
          </p>
          <p>
            <strong className="text-ink">Process punches</strong> is the step after that: it
            resolves enrolment numbers to people and folds each day&rsquo;s readings into the
            attendance register, using the same shift arithmetic every other screen uses.
          </p>
          <p className="text-xs text-ink-faint">
            A day that was corrected by hand, written by an approved regularisation, or locked for
            payroll is never overwritten by a sync. The punches are kept and marked, so the
            evidence survives without undoing somebody&rsquo;s decision.
          </p>
        </div>
      </Card>
    </>
  );
}
