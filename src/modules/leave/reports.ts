import "server-only";

import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { fiscalYears, holidays } from "@/db/schema/core";
import { employees as employeesTable } from "@/db/schema/hr";
import { approvalSteps, leaveBalances, leaveRequests, leaveTypes } from "@/db/schema/leave";
import { addDays, adToBs, formatBsKey, isSaturday, todayInNepal } from "@/lib/bs";
import { bucketDates, ratio, type Granularity } from "@/lib/reports/buckets";
import type { ReportFilters, ReportPeriod } from "@/lib/reports/period";
import { employeesInScope, type ScopedEmployee } from "@/lib/reports/scope";

/**
 * The leave reporting engine.
 *
 * Like attendance's, one pass produces every leave report — taken days,
 * balances, utilisation by type, the request history, approval turnaround and
 * the department view — so they cannot disagree.
 *
 * Two clocks, deliberately kept apart:
 *
 *   • the **period** (a BS month, a range) scopes what happened: days of leave
 *     that fell inside it, and the requests that cover those days;
 *   • the **fiscal year** scopes balances, because entitlement is granted per
 *     fiscal year. It is the year the period ends in, and every balance figure
 *     says which year it is.
 *
 * "Days in period" are counted the way a request's own total is: working days
 * only (Saturdays and holidays are never charged), and a half-day request is
 * half a day. A request running across the period boundary contributes only
 * the days inside it, so a Shrawan report never counts Bhadra.
 */

/** Leave that is not an absence: the person was working, somewhere else. */
const WORKING_NATURES = new Set(["official_work", "transit"]);

export type LeaveStatus = "draft" | "pending" | "approved" | "rejected" | "cancelled";

export type LeaveTypeInfo = {
  id: string;
  code: string;
  name: string;
  colour: string;
  nature: string;
  isPaid: boolean;
  lapseType: string;
  allowCarryForward: boolean;
  maxCarryForwardDays: number | null;
  /** Field work and transit: days away on duty, not absence. */
  isWorking: boolean;
  /**
   * An entitlement meant to be used within the year. Service-period leave —
   * maternity, paternity, study — is granted for a whole career and mostly
   * never touched, so pooling it with annual leave makes every utilisation
   * figure read as "nobody takes leave".
   */
  isAnnual: boolean;
};

export type RequestRow = {
  id: string;
  reference: string;
  employeeId: string;
  code: string;
  name: string;
  department: string | null;
  typeId: string;
  typeName: string;
  typeColour: string;
  isWorking: boolean;
  isUnpaid: boolean;
  fromDate: string;
  toDate: string;
  fromDateBs: string;
  toDateBs: string;
  portion: string;
  totalDays: number;
  /** Chargeable days of this request that fall inside the period. */
  daysInPeriod: number;
  status: LeaveStatus;
  reason: string;
  submittedAt: string | null;
  decidedAt: string | null;
  /** Submission to final decision, in hours. Null until decided. */
  turnaroundHours: number | null;
  /** Days since submission, for requests still pending. */
  pendingAgeDays: number | null;
  awaiting: string | null;
  currentLevel: number | null;
};

/** One fiscal-year balance, with the arithmetic done once. */
export type BalanceCell = {
  typeId: string;
  entitled: number;
  carried: number;
  used: number;
  pending: number;
  encashed: number;
  /** entitled + carried − used − pending − encashed */
  available: number;
  /** Share of the entitlement already used or reserved. */
  utilisation: number | null;
  /** Days that will lapse at year end if nothing is taken or encashed. */
  atRisk: number;
};

export type LeaveMetrics = {
  /** Approved leave days inside the period, absence natures only. */
  takenDays: number;
  /** Approved field work / transit days inside the period. */
  workingDays: number;
  unpaidDays: number;
  pendingDays: number;
  requests: number;
  approved: number;
  rejected: number;
  cancelled: number;
  pending: number;
  /** Separate approved requests — "spells" — inside the period. */
  spells: number;
  byType: Record<string, number>;
};

export type EmployeeLeaveRow = LeaveMetrics & {
  id: string;
  code: string;
  name: string;
  departmentId: string | null;
  department: string | null;
  designation: string | null;
  branch: string | null;
  balances: Record<string, BalanceCell>;
  /** Annual leave types only — service-period entitlements are left out of the totals. */
  totalEntitled: number;
  totalUsed: number;
  totalAvailable: number;
  totalAtRisk: number;
  utilisation: number | null;
  /** Any balance overdrawn below zero. */
  overdrawn: boolean;
};

export type TypeLeaveRow = LeaveMetrics & {
  type: LeaveTypeInfo;
  /** People with at least one approved day of this type in the period. */
  takers: number;
  avgRequestDays: number | null;
  entitled: number;
  used: number;
  pendingBalance: number;
  available: number;
  atRisk: number;
  utilisation: number | null;
  /** Share of decided requests that were rejected. */
  rejectionRate: number | null;
};

export type DepartmentLeaveRow = LeaveMetrics & {
  id: string | null;
  name: string;
  headcount: number;
  daysPerHead: number;
  peopleOnLeave: number;
};

export type LeaveDay = {
  date: string;
  dateBs: string;
  isOff: boolean;
  /** People on approved leave that day (absence natures). */
  onLeave: number;
  /** Chargeable days by leave type. */
  byType: Record<string, number>;
};

export type LeaveTrendBucket = {
  label: string;
  sublabel: string;
  byType: Record<string, number>;
  total: number;
  peakOnLeave: number;
};

export type ApproverRow = {
  key: string;
  label: string;
  /** The role the step was routed by, e.g. "Reporting supervisor". */
  role: string | null;
  decided: number;
  approved: number;
  rejected: number;
  pending: number;
  avgHours: number | null;
};

export type LeaveReport = {
  period: ReportPeriod;
  fiscalYear: { id: string; code: string; isClosed: boolean } | null;
  headcount: number;
  types: LeaveTypeInfo[];
  totals: LeaveMetrics & {
    peopleOnLeave: number;
    entitled: number;
    used: number;
    available: number;
    atRisk: number;
    utilisation: number | null;
    overdrawn: number;
    avgTurnaroundHours: number | null;
    medianTurnaroundHours: number | null;
    decidedWithin48h: number | null;
    rejectionRate: number | null;
  };
  employees: EmployeeLeaveRow[];
  byType: TypeLeaveRow[];
  departments: DepartmentLeaveRow[];
  requests: RequestRow[];
  days: LeaveDay[];
  trend: LeaveTrendBucket[];
  granularity: Granularity;
  approvers: ApproverRow[];
  /** Approved leave starting in the next 30 days, from today — not the period. */
  upcoming: RequestRow[];
  /** Pending requests by age: ≤1 day, 2–3, 4–7, older. */
  pendingAgeing: { label: string; count: number }[];
};

/* ------------------------------------------------------------------ helpers */

function emptyMetrics(): LeaveMetrics {
  return {
    takenDays: 0,
    workingDays: 0,
    unpaidDays: 0,
    pendingDays: 0,
    requests: 0,
    approved: 0,
    rejected: 0,
    cancelled: 0,
    pending: 0,
    spells: 0,
    byType: {},
  };
}

function addMetrics(into: LeaveMetrics, from: LeaveMetrics) {
  into.takenDays += from.takenDays;
  into.workingDays += from.workingDays;
  into.unpaidDays += from.unpaidDays;
  into.pendingDays += from.pendingDays;
  into.requests += from.requests;
  into.approved += from.approved;
  into.rejected += from.rejected;
  into.cancelled += from.cancelled;
  into.pending += from.pending;
  into.spells += from.spells;
  for (const [k, v] of Object.entries(from.byType)) into.byType[k] = (into.byType[k] ?? 0) + v;
}

/** Folds one request into a metrics bucket. */
function count(m: LeaveMetrics, r: RequestRow) {
  m.requests++;
  if (r.status === "approved") {
    m.approved++;
    if (r.daysInPeriod > 0) m.spells++;
    if (r.isWorking) m.workingDays += r.daysInPeriod;
    else m.takenDays += r.daysInPeriod;
    if (r.isUnpaid) m.unpaidDays += r.daysInPeriod;
    m.byType[r.typeId] = (m.byType[r.typeId] ?? 0) + r.daysInPeriod;
  } else if (r.status === "pending") {
    m.pending++;
    m.pendingDays += r.daysInPeriod;
  } else if (r.status === "rejected") {
    m.rejected++;
  } else if (r.status === "cancelled") {
    m.cancelled++;
  }
}

function num(value: string | number | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function hoursBetween(a: Date, b: Date): number {
  return Math.max(0, (b.getTime() - a.getTime()) / 3_600_000);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** What lapses at year end, from the type's own carry-forward rule. */
function lapseRisk(type: LeaveTypeInfo | undefined, available: number): number {
  if (!type || available <= 0 || type.lapseType === "none" || type.isWorking) return 0;
  if (!type.allowCarryForward) return available;
  if (type.maxCarryForwardDays === null) return 0;
  return Math.max(0, available - type.maxCarryForwardDays);
}

/* ------------------------------------------------------------------- engine */

export async function buildLeaveReport(
  orgId: string,
  period: ReportPeriod,
  filters: ReportFilters,
): Promise<LeaveReport> {
  const today = todayInNepal();
  const from = period.from;
  // Leave is planned: an approved request next week is a fact already, so the
  // period is *not* clipped to today the way attendance is.
  const to = period.to;

  const [staff, typeRows, [fy]] = await Promise.all([
    employeesInScope(orgId, from, to, filters),
    db
      .select({
        id: leaveTypes.id,
        code: leaveTypes.code,
        name: leaveTypes.name,
        colour: leaveTypes.colour,
        nature: leaveTypes.nature,
        isPaid: leaveTypes.isPaid,
        lapseType: leaveTypes.lapseType,
        allowCarryForward: leaveTypes.allowCarryForward,
        maxCarryForwardDays: leaveTypes.maxCarryForwardDays,
        isActive: leaveTypes.isActive,
      })
      .from(leaveTypes)
      .where(eq(leaveTypes.orgId, orgId))
      .orderBy(asc(leaveTypes.leaveOrder), asc(leaveTypes.code)),
    // the fiscal year the period ends in
    db
      .select({ id: fiscalYears.id, code: fiscalYears.code, isClosed: fiscalYears.isClosed })
      .from(fiscalYears)
      .where(and(eq(fiscalYears.orgId, orgId), lte(fiscalYears.startDate, to), gte(fiscalYears.endDate, to)))
      .limit(1),
  ]);

  const types: LeaveTypeInfo[] = typeRows.map((t) => ({
    id: t.id,
    code: t.code,
    name: t.name,
    colour: t.colour,
    nature: t.nature,
    isPaid: t.isPaid,
    lapseType: t.lapseType,
    allowCarryForward: t.allowCarryForward,
    maxCarryForwardDays: t.maxCarryForwardDays === null ? null : num(t.maxCarryForwardDays),
    isWorking: WORKING_NATURES.has(t.nature),
    isAnnual: !WORKING_NATURES.has(t.nature) && t.lapseType !== "service_period",
  }));
  const typeById = new Map(types.map((t) => [t.id, t]));
  const staffById = new Map(staff.map((s) => [s.id, s]));
  const ids = staff.map((s) => s.id);

  const upcomingTo = addDays(today, 30);
  const windowFrom = from < today ? from : today;
  const windowTo = to > upcomingTo ? to : upcomingTo;

  const [requestRows, balanceRows, holidayRows] = await Promise.all([
    ids.length === 0
      ? Promise.resolve([])
      : db
          .select({
            id: leaveRequests.id,
            reference: leaveRequests.reference,
            employeeId: leaveRequests.employeeId,
            leaveTypeId: leaveRequests.leaveTypeId,
            fromDate: leaveRequests.fromDate,
            toDate: leaveRequests.toDate,
            fromDateBs: leaveRequests.fromDateBs,
            toDateBs: leaveRequests.toDateBs,
            portion: leaveRequests.portion,
            totalDays: leaveRequests.totalDays,
            status: leaveRequests.status,
            reason: leaveRequests.reason,
            submittedAt: leaveRequests.submittedAt,
            decidedAt: leaveRequests.decidedAt,
            currentLevel: leaveRequests.currentLevel,
          })
          .from(leaveRequests)
          .where(
            and(
              eq(leaveRequests.orgId, orgId),
              inArray(leaveRequests.employeeId, ids),
              // overlaps the period, or the next-30-days window for "upcoming"
              lte(leaveRequests.fromDate, windowTo),
              gte(leaveRequests.toDate, windowFrom),
            ),
          ),
    fy && ids.length
      ? db
          .select({
            employeeId: leaveBalances.employeeId,
            leaveTypeId: leaveBalances.leaveTypeId,
            entitled: leaveBalances.entitled,
            carried: leaveBalances.carriedForward,
            used: leaveBalances.used,
            pending: leaveBalances.pending,
            encashed: leaveBalances.encashed,
          })
          .from(leaveBalances)
          .where(and(eq(leaveBalances.fiscalYearId, fy.id), inArray(leaveBalances.employeeId, ids)))
      : Promise.resolve([]),
    db
      .select({ date: holidays.date })
      .from(holidays)
      .where(
        and(eq(holidays.orgId, orgId), eq(holidays.isActive, true), gte(holidays.date, windowFrom), lte(holidays.date, windowTo)),
      ),
  ]);

  const holidaySet = new Set(holidayRows.map((h) => h.date));
  const isWorkingDay = (d: string) => !isSaturday(d) && !holidaySet.has(d);

  // Approval steps, for who a pending request is waiting on and per-approver turnaround.
  const steps =
    requestRows.length === 0
      ? []
      : await db
          .select({
            entityId: approvalSteps.entityId,
            level: approvalSteps.level,
            approverEmployeeId: approvalSteps.approverEmployeeId,
            approverLabel: approvalSteps.approverLabel,
            decision: approvalSteps.decision,
            decidedAt: approvalSteps.decidedAt,
            createdAt: approvalSteps.createdAt,
          })
          .from(approvalSteps)
          .where(
            and(
              eq(approvalSteps.orgId, orgId),
              eq(approvalSteps.entityType, "leave_request"),
              inArray(
                approvalSteps.entityId,
                requestRows.map((r) => r.id),
              ),
            ),
          );
  // Step labels are roles ("Reporting supervisor"); the report needs people.
  const approverIds = [...new Set(steps.map((st) => st.approverEmployeeId).filter((v): v is string => !!v))];
  const approverNames = new Map(
    approverIds.length === 0
      ? []
      : (
          await db
            .select({
              id: employeesTable.id,
              name: sql<string>`${employeesTable.firstName} || ' ' || ${employeesTable.lastName}`,
            })
            .from(employeesTable)
            .where(inArray(employeesTable.id, approverIds))
        ).map((e) => [e.id, e.name] as const),
  );

  const stepsByRequest = new Map<string, typeof steps>();
  for (const s of steps) stepsByRequest.set(s.entityId, [...(stepsByRequest.get(s.entityId) ?? []), s]);

  const now = new Date();

  /* ------------------------------------------------------------ requests */

  const dates: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);
  const dayIndex = new Map(dates.map((d, i) => [d, i]));
  const days: LeaveDay[] = dates.map((date) => ({
    date,
    dateBs: formatBsKey(adToBs(date)),
    isOff: !isWorkingDay(date),
    onLeave: 0,
    byType: {},
  }));
  const onLeaveByDay = dates.map(() => new Set<string>());

  const allRequests: RequestRow[] = [];
  for (const r of requestRows) {
    const person = staffById.get(r.employeeId) as ScopedEmployee;
    const type = typeById.get(r.leaveTypeId);
    const isHalf = r.portion !== "full";

    // chargeable days inside the period, walked day by day
    let inPeriod = 0;
    const overlapFrom = r.fromDate > from ? r.fromDate : from;
    const overlapTo = r.toDate < to ? r.toDate : to;
    for (let d = overlapFrom; d <= overlapTo; d = addDays(d, 1)) {
      if (!isWorkingDay(d)) continue;
      const share = isHalf ? 0.5 : 1;
      inPeriod += share;
      if (r.status === "approved") {
        const i = dayIndex.get(d)!;
        days[i].byType[r.leaveTypeId] = (days[i].byType[r.leaveTypeId] ?? 0) + share;
        if (!type?.isWorking) onLeaveByDay[i].add(r.employeeId);
      }
    }
    // A request wholly inside the period is authoritative on its own total —
    // it was computed against the calendar as it stood when it was submitted.
    if (r.fromDate >= from && r.toDate <= to) inPeriod = num(r.totalDays);

    const requestSteps = stepsByRequest.get(r.id) ?? [];
    const waitingOn = requestSteps.find((s) => s.level === r.currentLevel && s.decision === "pending");

    allRequests.push({
      id: r.id,
      reference: r.reference,
      employeeId: r.employeeId,
      code: person.code,
      name: person.name,
      department: person.department,
      typeId: r.leaveTypeId,
      typeName: type?.name ?? "Leave",
      typeColour: type?.colour ?? "#64748b",
      isWorking: type?.isWorking ?? false,
      isUnpaid: type ? !type.isPaid || type.nature === "unpaid" : false,
      fromDate: r.fromDate,
      toDate: r.toDate,
      fromDateBs: r.fromDateBs,
      toDateBs: r.toDateBs,
      portion: r.portion,
      totalDays: num(r.totalDays),
      daysInPeriod: r.fromDate <= to && r.toDate >= from ? inPeriod : 0,
      status: r.status as LeaveStatus,
      reason: r.reason,
      submittedAt: r.submittedAt?.toISOString() ?? null,
      decidedAt: r.decidedAt?.toISOString() ?? null,
      turnaroundHours:
        r.submittedAt && r.decidedAt && (r.status === "approved" || r.status === "rejected")
          ? hoursBetween(r.submittedAt, r.decidedAt)
          : null,
      pendingAgeDays:
        r.status === "pending" && r.submittedAt ? Math.floor(hoursBetween(r.submittedAt, now) / 24) : null,
      awaiting:
        r.status === "pending"
          ? (waitingOn?.approverEmployeeId && approverNames.get(waitingOn.approverEmployeeId)) ||
            waitingOn?.approverLabel ||
            "Approver"
          : null,
      currentLevel: r.currentLevel,
    });
  }

  days.forEach((d, i) => (d.onLeave = onLeaveByDay[i].size));

  const requests = allRequests
    .filter((r) => r.fromDate <= to && r.toDate >= from)
    .sort((a, b) => (a.fromDate === b.fromDate ? a.code.localeCompare(b.code) : a.fromDate < b.fromDate ? 1 : -1));

  const upcoming = allRequests
    .filter((r) => r.status === "approved" && r.toDate >= today && r.fromDate <= upcomingTo)
    .sort((a, b) => (a.fromDate < b.fromDate ? -1 : a.fromDate > b.fromDate ? 1 : a.code.localeCompare(b.code)));

  /* ------------------------------------------------------------ balances */

  const balances = new Map<string, Record<string, BalanceCell>>();
  for (const b of balanceRows) {
    const entitled = num(b.entitled);
    const carried = num(b.carried);
    const used = num(b.used);
    const pending = num(b.pending);
    const encashed = num(b.encashed);
    const available = entitled + carried - used - pending - encashed;
    const cell: BalanceCell = {
      typeId: b.leaveTypeId,
      entitled,
      carried,
      used,
      pending,
      encashed,
      available,
      utilisation: ratio(used + pending, entitled + carried),
      atRisk: fy && !fy.isClosed ? lapseRisk(typeById.get(b.leaveTypeId), available) : 0,
    };
    const byEmployee = balances.get(b.employeeId) ?? {};
    byEmployee[b.leaveTypeId] = cell;
    balances.set(b.employeeId, byEmployee);
  }

  /* ------------------------------------------------------------ employees */

  const byEmployeeRequests = new Map<string, RequestRow[]>();
  for (const r of requests) byEmployeeRequests.set(r.employeeId, [...(byEmployeeRequests.get(r.employeeId) ?? []), r]);

  const employees: EmployeeLeaveRow[] = staff.map((s) => {
    const m = emptyMetrics();
    for (const r of byEmployeeRequests.get(s.id) ?? []) count(m, r);

    const cells = balances.get(s.id) ?? {};
    let entitled = 0;
    let used = 0;
    let available = 0;
    let atRisk = 0;
    let overdrawn = false;
    // totals are annual leave only; see LeaveTypeInfo.isAnnual
    for (const c of Object.values(cells)) {
      // an overdrawn balance matters on any type, service-period ones included
      if (c.available < 0) overdrawn = true;
      if (!typeById.get(c.typeId)?.isAnnual) continue;
      entitled += c.entitled + c.carried;
      used += c.used + c.pending;
      available += c.available;
      atRisk += c.atRisk;
    }

    return {
      ...m,
      id: s.id,
      code: s.code,
      name: s.name,
      departmentId: s.departmentId,
      department: s.department,
      designation: s.designation,
      branch: s.branch,
      balances: cells,
      totalEntitled: entitled,
      totalUsed: used,
      totalAvailable: available,
      totalAtRisk: atRisk,
      utilisation: ratio(used, entitled),
      overdrawn,
    };
  });

  /* ---------------------------------------------------------------- types */

  const byType: TypeLeaveRow[] = types
    .map((type) => {
      const m = emptyMetrics();
      const typeRequests = requests.filter((r) => r.typeId === type.id);
      for (const r of typeRequests) count(m, r);
      const takers = new Set(typeRequests.filter((r) => r.status === "approved" && r.daysInPeriod > 0).map((r) => r.employeeId));

      let entitled = 0;
      let used = 0;
      let pendingBalance = 0;
      let available = 0;
      let atRisk = 0;
      for (const e of employees) {
        const c = e.balances[type.id];
        if (!c) continue;
        entitled += c.entitled + c.carried;
        used += c.used;
        pendingBalance += c.pending;
        available += c.available;
        atRisk += c.atRisk;
      }
      const approvedDays = typeRequests.filter((r) => r.status === "approved").reduce((n, r) => n + r.daysInPeriod, 0);

      return {
        ...m,
        type,
        takers: takers.size,
        avgRequestDays: m.approved ? approvedDays / m.approved : null,
        entitled,
        used,
        pendingBalance,
        available,
        atRisk,
        utilisation: ratio(used + pendingBalance, entitled),
        rejectionRate: ratio(m.rejected, m.approved + m.rejected),
      };
    })
    // a type nobody holds and nobody used is noise in every table
    .filter((t) => t.requests > 0 || t.entitled > 0);

  /* ---------------------------------------------------------- departments */

  const deptMap = new Map<string, DepartmentLeaveRow>();
  for (const e of employees) {
    const key = e.departmentId ?? "none";
    let d = deptMap.get(key);
    if (!d) {
      d = { ...emptyMetrics(), id: e.departmentId, name: e.department ?? "No department", headcount: 0, daysPerHead: 0, peopleOnLeave: 0 };
      deptMap.set(key, d);
    }
    addMetrics(d, e);
    d.headcount++;
    if (e.takenDays > 0) d.peopleOnLeave++;
  }
  const departments = [...deptMap.values()].map((d) => ({ ...d, daysPerHead: d.headcount ? d.takenDays / d.headcount : 0 }));

  /* ---------------------------------------------------------------- trend */

  const { granularity, buckets } = bucketDates(dates);
  const trend: LeaveTrendBucket[] = buckets.map((b) => {
    const byTypeTotals: Record<string, number> = {};
    let peak = 0;
    for (const i of b.indexes) {
      for (const [k, v] of Object.entries(days[i].byType)) byTypeTotals[k] = (byTypeTotals[k] ?? 0) + v;
      peak = Math.max(peak, days[i].onLeave);
    }
    return {
      label: b.label,
      sublabel: b.sublabel,
      byType: byTypeTotals,
      total: Object.values(byTypeTotals).reduce((a, v) => a + v, 0),
      peakOnLeave: peak,
    };
  });

  /* ------------------------------------------------------------ approvals */

  const approverMap = new Map<string, ApproverRow & { hours: number[] }>();
  for (const r of requests) {
    // Every step is written at submission, so a later level's clock starts
    // when the level before it decided — otherwise a second approver would be
    // charged for the first one's delay.
    // Level one starts at submission — the request's own timestamp, which is
    // what the requester experienced, rather than the step row's createdAt.
    let clockStart: Date | null = r.submittedAt ? new Date(r.submittedAt) : null;
    const ordered = [...(stepsByRequest.get(r.id) ?? [])].sort((a, b) => a.level - b.level);
    for (const s of ordered) {
      const startedAt: Date = clockStart ?? s.createdAt;
      if (s.decidedAt) clockStart = s.decidedAt;
      if (s.decision === "skipped") continue;
      const key = s.approverEmployeeId ?? `label:${s.approverLabel ?? "?"}`;
      const row =
        approverMap.get(key) ??
        {
          key,
          label: (s.approverEmployeeId && approverNames.get(s.approverEmployeeId)) || s.approverLabel || "Approver",
          role: s.approverLabel,
          decided: 0,
          approved: 0,
          rejected: 0,
          pending: 0,
          avgHours: null,
          hours: [],
        };
      if (s.decision === "pending") {
        // only the current level is waiting on anybody; later levels have not
        // been reached, and counting them would blame an approver who has
        // nothing in front of them yet
        if (r.status === "pending" && s.level === r.currentLevel) row.pending++;
        else continue;
      } else {
        row.decided++;
        if (s.decision === "approved") row.approved++;
        if (s.decision === "rejected") row.rejected++;
        if (s.decidedAt) row.hours.push(hoursBetween(startedAt, s.decidedAt));
      }
      approverMap.set(key, row);
    }
  }
  const approvers = [...approverMap.values()]
    .map(({ hours, ...row }) => ({ ...row, avgHours: hours.length ? hours.reduce((a, b) => a + b, 0) / hours.length : null }))
    .sort((a, b) => b.decided + b.pending - (a.decided + a.pending));

  const pendingRequests = requests.filter((r) => r.status === "pending");
  const ageing = [0, 0, 0, 0];
  for (const r of pendingRequests) {
    const age = r.pendingAgeDays ?? 0;
    ageing[age <= 1 ? 0 : age <= 3 ? 1 : age <= 7 ? 2 : 3]++;
  }

  /* --------------------------------------------------------------- totals */

  const totalsMetrics = emptyMetrics();
  for (const e of employees) addMetrics(totalsMetrics, e);
  const turnarounds = requests.map((r) => r.turnaroundHours).filter((h): h is number => h !== null);
  const entitled = employees.reduce((a, e) => a + e.totalEntitled, 0);
  const used = employees.reduce((a, e) => a + e.totalUsed, 0);

  return {
    period,
    fiscalYear: fy ?? null,
    headcount: staff.length,
    types,
    totals: {
      ...totalsMetrics,
      peopleOnLeave: employees.filter((e) => e.takenDays > 0).length,
      entitled,
      used,
      available: employees.reduce((a, e) => a + e.totalAvailable, 0),
      atRisk: employees.reduce((a, e) => a + e.totalAtRisk, 0),
      utilisation: ratio(used, entitled),
      overdrawn: employees.filter((e) => e.overdrawn).length,
      avgTurnaroundHours: turnarounds.length ? turnarounds.reduce((a, b) => a + b, 0) / turnarounds.length : null,
      medianTurnaroundHours: median(turnarounds),
      decidedWithin48h: ratio(turnarounds.filter((h) => h <= 48).length, turnarounds.length),
      rejectionRate: ratio(totalsMetrics.rejected, totalsMetrics.approved + totalsMetrics.rejected),
    },
    employees,
    byType,
    departments,
    requests,
    days,
    trend,
    granularity,
    approvers,
    upcoming,
    pendingAgeing: [
      { label: "Up to a day", count: ageing[0] },
      { label: "2–3 days", count: ageing[1] },
      { label: "4–7 days", count: ageing[2] },
      { label: "Over a week", count: ageing[3] },
    ],
  };
}

/* ----------------------------------------------------------------- sorting */

export const LEAVE_EMPLOYEE_SORT_KEYS = [
  "code", "name", "department", "taken", "working", "unpaid", "pendingDays", "requests", "spells",
  "rejected", "entitled", "used", "available", "atRisk", "utilisation",
] as const;

export function leaveEmployeeSortValue(r: EmployeeLeaveRow, key: string): string | number | null {
  if (key.startsWith("type:")) return r.balances[key.slice(5)]?.available ?? null;
  switch (key) {
    case "code": return r.code;
    case "name": return r.name;
    case "department": return r.department;
    case "taken": return r.takenDays;
    case "working": return r.workingDays;
    case "unpaid": return r.unpaidDays;
    case "pendingDays": return r.pendingDays;
    case "requests": return r.requests;
    case "spells": return r.spells;
    case "rejected": return r.rejected;
    case "entitled": return r.totalEntitled;
    case "used": return r.totalUsed;
    case "available": return r.totalAvailable;
    case "atRisk": return r.totalAtRisk;
    case "utilisation": return r.utilisation;
    default: return null;
  }
}

/** Human labels, used by the history filters and the CSV. */
export const LEAVE_STATUS_LABEL: Record<LeaveStatus, string> = {
  draft: "Draft",
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Withdrawn",
};

/** "18h", "2.5d" — turnaround in the unit that reads naturally. */
export function formatTurnaround(hours: number | null): string {
  if (hours === null) return "—";
  if (hours < 1) return "<1h";
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}
