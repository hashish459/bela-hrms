import type { ReportTab } from "@/components/reports/report-tabs";

export const BASE = "/attendance/reports";

/** The attendance reports, in the order a reader usually needs them. */
export const ATTENDANCE_REPORT_TABS: ReportTab[] = [
  { href: BASE, label: "Overview", icon: "LayoutDashboard" },
  { href: `${BASE}/muster`, label: "Muster roll", icon: "Sheet" },
  { href: `${BASE}/late`, label: "Late & early exit", icon: "AlarmClock" },
  { href: `${BASE}/absence`, label: "Absenteeism", icon: "UserX" },
  { href: `${BASE}/overtime`, label: "Overtime", icon: "TimerReset" },
  { href: `${BASE}/exceptions`, label: "Exceptions", icon: "TriangleAlert" },
  { href: `${BASE}/departments`, label: "Departments", icon: "Building2" },
];
