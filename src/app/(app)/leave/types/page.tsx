import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { leaveTypes } from "@/db/schema/leave";
import { requirePermission } from "@/lib/session";
import { PageHeader, StatTile } from "@/components/ui";
import { formatDays } from "@/lib/utils";
import { leaveTypeUsage } from "@/modules/leave/admin";
import { listLeaveGroups } from "@/modules/leave/policy";
import { TypesBoard, type TypeCard } from "./types-board";

export const metadata = { title: "Leave types" };

const LAPSE: Record<string, string> = {
  none: "Never lapse",
  yearly: "Lapse yearly",
  monthly: "Lapse monthly",
  service_period: "Per event",
};

/**
 * The leave type catalogue — create, edit, duplicate, switch off and (while
 * unused) delete. What a type means to attendance and pay, and who may
 * approve how much of it, is edited here; entitlements by employment type and
 * groups live on the policy screen.
 */
export default async function LeaveTypesPage({ searchParams }: PageProps<"/leave/types">) {
  const viewer = await requirePermission("leave.type.manage");
  const params = await searchParams;
  const [rows, usage, groups] = await Promise.all([
    db.select().from(leaveTypes).where(eq(leaveTypes.orgId, viewer.orgId)).orderBy(asc(leaveTypes.leaveOrder), asc(leaveTypes.name)),
    leaveTypeUsage(viewer.orgId),
    listLeaveGroups(viewer.orgId),
  ]);
  const groupName = new Map(groups.map((g) => [g.id, g.name]));

  const cards: TypeCard[] = rows.map((t) => {
    const limits = [t.level1LimitDays, t.level2LimitDays, t.level3LimitDays, t.level4LimitDays].slice(0, t.approvalLevels).filter((l) => l !== null);
    const u = usage.get(t.id);
    const carry =
      t.allowCarryForward && (t.lapseType === "yearly" || t.lapseType === "none")
        ? ` · carry ${t.maxCarryForwardDays === null ? "all" : formatDays(t.maxCarryForwardDays)}`
        : "";
    return {
      id: t.id,
      code: t.code,
      name: t.name,
      nameNepali: t.nameNepali,
      colour: t.colour,
      isActive: t.isActive,
      group: t.leaveGroupId ? (groupName.get(t.leaveGroupId) ?? null) : null,
      groupId: t.leaveGroupId,
      summary: {
        daysPerYear: t.deductsBalance ? `${formatDays(t.daysPerYear)} days` : "Unlimited",
        paid: Number(t.paidPercent) === 0 ? "Unpaid" : `${Number(t.paidPercent)}%`,
        lapse: `${LAPSE[t.lapseType]}${carry}`,
        approvals: `${t.approvalLevels} level${t.approvalLevels === 1 ? "" : "s"}${limits.length ? ` · ${limits.join("/")} d` : ""}`,
        eligibility:
          t.appliesTo !== "all" || t.maritalStatus
            ? [t.appliesTo === "female" ? "Women" : t.appliesTo === "male" ? "Men" : null, t.maritalStatus].filter(Boolean).join(", ")
            : null,
      },
      flags: [
        t.isEncashable ? "Encashable" : null,
        t.allowHalfDay ? "Half days" : null,
        t.minNoticeDays ? `${t.minNoticeDays}d notice` : null,
        t.maxConsecutiveDays ? `max ${t.maxConsecutiveDays}d` : null,
        t.requiresAttachmentAfterDays !== null ? `document after ${t.requiresAttachmentAfterDays}d` : null,
        t.applyWindow === "pre" ? "In advance only" : t.applyWindow === "post" ? "Afterwards only" : null,
        t.timesAllowedInService ? `${t.timesAllowedInService}× in service` : null,
      ].filter((f): f is string => Boolean(f)),
      usage: { requests: u?.requests ?? 0, open: u?.open ?? 0, holders: u?.holders ?? 0 },
      values: {
        code: t.code,
        name: t.name,
        nameNepali: t.nameNepali,
        colour: t.colour,
        leaveGroupId: t.leaveGroupId,
        nature: t.nature,
        paidPercent: Number(t.paidPercent),
        unit: t.unit,
        leaveOrder: t.leaveOrder,
        daysPerYear: Number(t.daysPerYear),
        deductsBalance: t.deductsBalance,
        allowHalfDay: t.allowHalfDay,
        allocationRule: t.allocationRule,
        isAllocatedInFull: t.isAllocatedInFull,
        appliesTo: t.appliesTo,
        maritalStatus: t.maritalStatus,
        minNoticeDays: t.minNoticeDays,
        maxConsecutiveDays: t.maxConsecutiveDays,
        requiresAttachmentAfterDays: t.requiresAttachmentAfterDays,
        applyWindow: t.applyWindow,
        qualifyFrom: t.qualifyFrom,
        minDaysToQualify: t.minDaysToQualify,
        timesAllowedInService: t.timesAllowedInService,
        maxDaysToApply: t.maxDaysToApply,
        excludesHolidays: t.excludesHolidays,
        excludesWeeklyOffs: t.excludesWeeklyOffs,
        approvalLevels: t.approvalLevels,
        level1LimitDays: t.level1LimitDays,
        level2LimitDays: t.level2LimitDays,
        level3LimitDays: t.level3LimitDays,
        level4LimitDays: t.level4LimitDays,
        notifiesHr: t.notifiesHr,
        lapseType: t.lapseType,
        allowCarryForward: t.allowCarryForward,
        maxCarryForwardDays: t.maxCarryForwardDays === null ? null : Number(t.maxCarryForwardDays),
        maxAccumulationDays: t.maxAccumulationDays === null ? null : Number(t.maxAccumulationDays),
        isEncashable: t.isEncashable,
        minDaysToEncash: t.minDaysToEncash === null ? null : Number(t.minDaysToEncash),
        maxDaysToEncash: t.maxDaysToEncash === null ? null : Number(t.maxDaysToEncash),
        isExcessDeductedFromPay: t.isExcessDeductedFromPay,
        isDeductedFromServiceTime: t.isDeductedFromServiceTime,
      },
    };
  });

  const active = rows.filter((t) => t.isActive);

  return (
    <>
      <PageHeader
        title="Leave types"
        description="Every kind of leave the organisation grants: its entitlement, rules, approval route and what happens to unused days."
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Active types" value={active.length} sub={`${rows.length - active.length} switched off`} tone="accent" />
        <StatTile label="With a balance" value={active.filter((t) => t.deductsBalance).length} sub="tracked per person per year" />
        <StatTile label="Encashable" value={active.filter((t) => t.isEncashable).length} tone="ok" />
        <StatTile label="Unpaid" value={active.filter((t) => Number(t.paidPercent) === 0).length} tone="warn" />
      </div>
      <TypesBoard cards={cards} groups={groups.map((g) => ({ id: g.id, name: g.name }))} editId={typeof params.edit === "string" ? params.edit : null} />
    </>
  );
}
