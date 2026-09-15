import {
  ATTENDANCE_STATUS_CODE,
  ATTENDANCE_STATUS_LABEL,
  formatDuration,
  shortTime,
  type AttendanceStatus,
} from "@/lib/attendance/calc";
import type { MonthDay } from "@/lib/attendance";
import { Badge, TableShell, Td, Th, Tr, type Tone } from "@/components/ui";

/** One tone per status, used by both the day sheet and the monthly matrix. */
export const STATUS_TONE: Record<AttendanceStatus, Tone> = {
  present: "ok",
  half_day: "warn",
  absent: "danger",
  weekly_off: "neutral",
  holiday: "info",
  on_leave: "accent",
  missing_punch: "warn",
  not_marked: "neutral",
};

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function statusOf(d: MonthDay): AttendanceStatus {
  if (d.record) return d.record.status;
  if (d.leaveName) return "on_leave";
  if (d.holidayName) return "holiday";
  if (d.isWeeklyOff) return "weekly_off";
  return "not_marked";
}

/** A single employee's month, one row per day. */
export function AttendanceSheet({ days, today }: { days: MonthDay[]; today: string }) {
  return (
    <TableShell>
      <thead>
        <tr>
          <Th>Date (BS)</Th>
          <Th>Day</Th>
          <Th>Shift</Th>
          <Th>In</Th>
          <Th>Out</Th>
          <Th className="text-right">Worked</Th>
          <Th className="text-right">Late</Th>
          <Th className="text-right">OT</Th>
          <Th>Status</Th>
          <Th>Note</Th>
        </tr>
      </thead>
      <tbody>
        {days.map((d) => {
          const status = statusOf(d);
          const isToday = d.date === today;
          const isFuture = d.date > today;
          return (
            <Tr key={d.date} className={isToday ? "bg-accent-soft/40" : undefined}>
              <Td className="tabular whitespace-nowrap">
                <span className={isToday ? "font-semibold text-ink" : "text-ink-soft"}>
                  {d.dateBs}
                </span>
                <span className="ml-1.5 text-[11px] text-ink-faint">
                  {new Date(d.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                </span>
              </Td>
              <Td
                className={
                  d.isWeeklyOff ? "text-[11px] text-ink-faint" : "text-[11px] text-ink-soft"
                }
              >
                {WEEKDAY[d.weekday]}
              </Td>
              <Td className="text-xs text-ink-faint">{d.shiftName ?? "—"}</Td>
              <Td className="tabular">{shortTime(d.record?.checkIn)}</Td>
              <Td className="tabular">{shortTime(d.record?.checkOut)}</Td>
              <Td className="tabular text-right">{formatDuration(d.record?.workedMinutes)}</Td>
              <Td
                className={`tabular text-right ${
                  (d.record?.lateMinutes ?? 0) > 0 ? "text-warn" : "text-ink-faint"
                }`}
              >
                {d.record?.lateMinutes ? `${d.record.lateMinutes}m` : "—"}
              </Td>
              <Td
                className={`tabular text-right ${
                  (d.record?.otMinutes ?? 0) > 0 ? "text-info" : "text-ink-faint"
                }`}
              >
                {formatDuration(d.record?.otMinutes)}
              </Td>
              <Td>
                {isFuture ? (
                  <span className="text-xs text-ink-faint">—</span>
                ) : (
                  <Badge tone={STATUS_TONE[status]}>{ATTENDANCE_STATUS_LABEL[status]}</Badge>
                )}
              </Td>
              <Td className="max-w-48 truncate text-xs text-ink-faint">
                {d.holidayName ?? d.leaveName ?? d.record?.remarks ?? ""}
              </Td>
            </Tr>
          );
        })}
      </tbody>
    </TableShell>
  );
}

export function AttendanceLegend() {
  const entries: AttendanceStatus[] = [
    "present",
    "half_day",
    "absent",
    "on_leave",
    "weekly_off",
    "holiday",
    "missing_punch",
    "not_marked",
  ];
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-ink-faint">
      {entries.map((s) => (
        <span key={s} className="flex items-center gap-1.5">
          <span className="tabular inline-grid size-4 place-items-center rounded bg-sunk font-mono text-[10px] text-ink-soft">
            {ATTENDANCE_STATUS_CODE[s]}
          </span>
          {ATTENDANCE_STATUS_LABEL[s]}
        </span>
      ))}
      <span className="ml-auto">Worked time is net of the shift break.</span>
    </div>
  );
}

export { statusOf, WEEKDAY };
