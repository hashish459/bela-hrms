import { requirePermission } from "@/lib/session";
import { monthSheet } from "@/lib/attendance";
import { adToBs, todayInNepal } from "@/lib/bs";
import { BsMonthNav, bsMonthBounds } from "@/components/bs-month-nav";
import { Card, EmptyState, PageHeader, StatTile } from "@/components/ui";
import { AttendanceSheet, AttendanceLegend } from "../sheet";

export const metadata = { title: "My attendance" };

export default async function MyAttendancePage({ searchParams }: PageProps<"/attendance/my">) {
  const viewer = await requirePermission("attendance.record.viewOwn");
  const params = await searchParams;

  if (!viewer.employeeId) {
    return (
      <>
        <PageHeader title="My attendance" />
        <Card>
          <EmptyState
            title="This login is not linked to an employee record"
            hint="An administrator can link it from Administration › Users."
          />
        </Card>
      </>
    );
  }

  const today = todayInNepal();
  const nowBs = adToBs(today);
  const month = {
    year: Number(params.y) || nowBs.year,
    month: Number(params.m) || nowBs.month,
  };
  const { from, to } = bsMonthBounds(month);

  const { days, summary } = await monthSheet(viewer.orgId, viewer.employeeId, from, to);

  const hours = (m: number) => (m / 60).toFixed(1);

  return (
    <>
      <PageHeader
        title="My attendance"
        description="Saturdays and public holidays are weekly offs. Corrections go to your supervisor."
        action={<BsMonthNav basePath="/attendance/my" current={month} />}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile
          label="Payable days"
          value={summary.payableDays}
          tone="accent"
          sub={`${summary.present} present · ${summary.halfDay} half`}
        />
        <StatTile
          label="Absent"
          value={summary.absent}
          tone={summary.absent > 0 ? "danger" : "neutral"}
          sub={summary.onLeave > 0 ? `${summary.onLeave} on leave` : "No unexplained days"}
        />
        <StatTile
          label="Late arrivals"
          value={summary.lateCount}
          tone={summary.lateCount > 3 ? "warn" : "neutral"}
          sub={`${summary.totalLateMinutes} minutes total`}
        />
        <StatTile
          label="Overtime"
          value={`${hours(summary.totalOtMinutes)}h`}
          tone={summary.totalOtMinutes > 0 ? "info" : "neutral"}
        />
        <StatTile
          label="Hours worked"
          value={`${hours(summary.totalWorkedMinutes)}h`}
          sub={summary.missingPunch > 0 ? `${summary.missingPunch} missing punch` : undefined}
        />
      </div>

      <div className="mt-4">
        <AttendanceSheet days={days} today={today} />
      </div>

      <AttendanceLegend />
    </>
  );
}
