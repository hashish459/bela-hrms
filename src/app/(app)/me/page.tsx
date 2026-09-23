import Link from "next/link";
import { CalendarDays, Cake, Clock, Megaphone, Pin } from "lucide-react";
import { deskSummary, profile } from "@/modules/selfservice/desk";
import { requireSelf } from "@/modules/selfservice/guard";
import { formatBs, adToBs } from "@/lib/bs";
import { Badge, StatTile } from "@/components/ui";
import { DonutChart } from "@/components/charts";
import {
  Avatar,
  BalanceMeter,
  DeskHeader,
  Dot,
  Panel,
  PanelEmpty,
  PanelLink,
  QuickActions,
  StatusChip,
} from "./parts";

export const metadata = { title: "My Desk" };

/**
 * The Employee Desk.
 *
 * The legacy equivalent was a grid of eleven widgets, none of which answered the
 * question people opened it for. This one is ordered by what somebody actually
 * needs, in the order they need it: what they should do now, where they stand
 * today, what they have left to spend, and what is coming.
 *
 * Everything is scoped by `requireSelf()`, which reads the employee id from the
 * session. There is no id in the URL to change.
 */

function greetingFor(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default async function MyDeskPage() {
  const ctx = await requireSelf();
  const [me, desk] = await Promise.all([profile(ctx), deskSummary(ctx)]);

  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kathmandu",
      hour: "2-digit",
      hour12: false,
    }).format(new Date()),
  );

  const firstName = ctx.viewer.name.split(" ")[0];
  const totalAvailable = desk.balances.reduce((sum, b) => sum + Math.max(0, b.available), 0);
  const attendanceMix = [
    { label: "Present", value: desk.stats.workedDays, colour: "var(--color-ok)" },
    {
      label: "On leave",
      value: desk.recentAttendance.filter((d) => d.status === "on_leave").length,
      colour: "var(--color-accent)",
    },
    {
      label: "Half day",
      value: desk.recentAttendance.filter((d) => d.status === "half_day").length,
      colour: "var(--color-warn)",
    },
    { label: "Absent", value: desk.stats.absentDays, colour: "var(--color-danger)" },
  ].filter((s) => s.value > 0);

  const countedDays = attendanceMix.reduce((sum, s) => sum + s.value, 0);

  return (
    <>
      <DeskHeader
        greeting={greetingFor(hour)}
        name={firstName}
        meta={
          <>
            <span>{me?.designation ?? "—"}</span>
            <Dot />
            <span>{me?.department ?? "—"}</span>
            <Dot />
            <span className="tabular">{formatBs(adToBs(desk.today.iso))}</span>
          </>
        }
        action={
          <div className="flex items-center gap-2.5 rounded-md border border-line bg-surface px-3 py-2">
            <Avatar name={ctx.viewer.name} photoUrl={me?.employee.photoUrl} size={34} />
            <div className="text-right">
              <p className="text-[11px] text-ink-faint">Today</p>
              <StatusChip status={desk.today.record?.status ?? null} />
            </div>
          </div>
        }
      />

      {/* --------------------------------------------------------- do this now */}
      <QuickActions
        items={[
          {
            href: "/leave/my",
            icon: "CalendarPlus",
            label: "Apply for leave",
            hint: `${totalAvailable.toFixed(totalAvailable % 1 ? 1 : 0)} days available`,
          },
          {
            href: "/attendance/requests",
            icon: "AlarmClockCheck",
            label: "Fix my attendance",
            hint: "Missing or wrong punch",
          },
          {
            href: "/me/calendar",
            icon: "CalendarRange",
            label: "My calendar",
            hint: "Month at a glance",
          },
          {
            href: "/me/profile",
            icon: "UserPen",
            label: "Update my details",
            hint: "Address, bank, family — HR applies it",
          },
        ]}
      />

      {/* --------------------------------------------------------- where I am */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Leave available"
          value={totalAvailable.toFixed(totalAvailable % 1 ? 1 : 0)}
          sub={`across ${desk.balances.length} type${desk.balances.length === 1 ? "" : "s"}`}
          tone="accent"
        />
        <StatTile
          label="Days at work"
          value={desk.stats.workedDays}
          sub="last 30 days"
          tone="ok"
        />
        <StatTile
          label="Late arrivals"
          value={desk.stats.lateDays}
          sub="last 30 days"
          tone={desk.stats.lateDays > 0 ? "warn" : "neutral"}
        />
        <StatTile
          label="Overtime"
          value={`${Math.floor(desk.stats.otMinutes / 60)}h ${desk.stats.otMinutes % 60}m`}
          sub="last 30 days"
          tone={desk.stats.otMinutes > 0 ? "info" : "neutral"}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <div className="flex flex-col gap-4">
          {/* ------------------------------------------------- notices first */}
          <Panel
            title="Notices"
            description={
              desk.unreadNotices.length > 0
                ? `${desk.unreadNotices.length} you have not read`
                : "Nothing new"
            }
            action={<PanelLink href="/me/notices">Open board</PanelLink>}
          >
            {desk.unreadNotices.length === 0 ? (
              <PanelEmpty>You are up to date.</PanelEmpty>
            ) : (
              <ul className="divide-y divide-line-soft">
                {desk.unreadNotices.slice(0, 3).map((n) => (
                  <li key={n.id}>
                    <Link
                      href={`/me/notices#${n.id}`}
                      className="flex gap-3 px-4 py-3 transition-colors hover:bg-sunk"
                    >
                      <span
                        className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-full ${
                          n.priority === "urgent"
                            ? "bg-danger-soft text-danger"
                            : n.priority === "important"
                              ? "bg-warn-soft text-warn"
                              : "bg-accent-soft text-accent"
                        }`}
                      >
                        {n.isPinned ? (
                          <Pin className="size-3.5" aria-hidden />
                        ) : (
                          <Megaphone className="size-3.5" aria-hidden />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-[13px] font-medium text-ink">{n.title}</span>
                          {n.priority !== "normal" ? (
                            <Badge tone={n.priority === "urgent" ? "danger" : "warn"}>
                              {n.priority}
                            </Badge>
                          ) : null}
                        </span>
                        <span className="mt-0.5 line-clamp-2 block text-xs text-ink-soft">
                          {n.body}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {/* ------------------------------------------------ my open requests */}
          <Panel
            title="My requests"
            description="Awaiting a decision"
            action={<PanelLink href="/leave/my">All my leave</PanelLink>}
          >
            {desk.pendingLeave.length === 0 ? (
              <PanelEmpty>Nothing outstanding.</PanelEmpty>
            ) : (
              <ul className="divide-y divide-line-soft">
                {desk.pendingLeave.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: r.colour }}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-ink">{r.typeName}</span>
                      <span className="tabular block text-[11px] text-ink-faint">
                        {r.fromDateBs}
                        {r.fromDateBs === r.toDateBs ? "" : ` → ${r.toDateBs}`}
                      </span>
                    </span>
                    <span className="tabular shrink-0 text-xs text-ink-soft">{r.totalDays} d</span>
                    <Badge tone="warn">pending</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {/* -------------------------------------------------- recent days */}
          <Panel
            title="Recent attendance"
            description="Last seven working days"
            action={<PanelLink href="/attendance/my">Full sheet</PanelLink>}
          >
            {desk.recentAttendance.length === 0 ? (
              <PanelEmpty>No attendance recorded yet.</PanelEmpty>
            ) : (
              <ul className="divide-y divide-line-soft">
                {desk.recentAttendance.slice(0, 7).map((d) => (
                  <li key={d.date} className="flex items-center gap-3 px-4 py-2">
                    <span className="tabular w-24 shrink-0 text-xs text-ink-soft">{d.dateBs}</span>
                    <span className="tabular w-28 shrink-0 text-xs text-ink-faint">
                      {d.checkIn ? d.checkIn.slice(0, 5) : "—"} –{" "}
                      {d.checkOut ? d.checkOut.slice(0, 5) : "—"}
                    </span>
                    <span className="flex-1" />
                    {d.lateMinutes > 0 ? (
                      <span className="tabular text-[11px] text-warn">+{d.lateMinutes}m late</span>
                    ) : null}
                    <StatusChip status={d.status} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="flex flex-col gap-4">
          {/* -------------------------------------------------- leave balances */}
          <Panel
            title="My leave balances"
            description="Available, after anything already reserved"
            action={<PanelLink href="/leave/my">Apply</PanelLink>}
          >
            {desk.balances.length === 0 ? (
              <PanelEmpty>No leave allocated for this fiscal year.</PanelEmpty>
            ) : (
              <ul className="divide-y divide-line-soft">
                {desk.balances.map((b) => (
                  <BalanceMeter
                    key={b.id}
                    name={b.typeName}
                    colour={b.colour}
                    entitled={Number(b.entitled) + Number(b.carriedForward)}
                    used={Number(b.used)}
                    pending={Number(b.pending)}
                    available={b.available}
                  />
                ))}
              </ul>
            )}
          </Panel>

          {/* ------------------------------------------------------ my month */}
          {countedDays > 0 ? (
            <Panel title="My last 30 days" description="Working days only">
              <div className="p-4">
                <DonutChart
                  size={140}
                  thickness={18}
                  centreValue={`${Math.round((desk.stats.workedDays / countedDays) * 100)}%`}
                  centreLabel="at work"
                  slices={attendanceMix}
                />
              </div>
            </Panel>
          ) : null}

          {/* ----------------------------------------------------- what's next */}
          <Panel
            title="Coming up"
            description="Holidays in the next six weeks"
            action={<PanelLink href="/me/calendar">Calendar</PanelLink>}
          >
            {desk.upcomingHolidays.length === 0 ? (
              <PanelEmpty>No holidays in the next six weeks.</PanelEmpty>
            ) : (
              <ul className="divide-y divide-line-soft">
                {desk.upcomingHolidays.map((h) => (
                  <li key={h.id} className="flex items-center gap-3 px-4 py-2.5">
                    <CalendarDays className="size-4 shrink-0 text-accent" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-ink">{h.name}</span>
                      <span className="tabular block text-[11px] text-ink-faint">{h.dateBs}</span>
                    </span>
                    <span className="tabular shrink-0 text-[11px] text-ink-faint">
                      {Math.max(
                        0,
                        Math.round(
                          (new Date(h.date).getTime() - new Date(desk.today.iso).getTime()) /
                            86_400_000,
                        ),
                      )}{" "}
                      days
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {/* ------------------------------------------------------ birthdays */}
          <Panel
            title="Birthdays"
            description="In the next fortnight"
            action={<PanelLink href="/me/directory">Directory</PanelLink>}
          >
            {desk.birthdays.length === 0 ? (
              <PanelEmpty>None coming up.</PanelEmpty>
            ) : (
              <ul className="divide-y divide-line-soft">
                {desk.birthdays.map((b) => (
                  <li key={b.id} className="flex items-center gap-3 px-4 py-2">
                    <Avatar name={b.name} photoUrl={b.photoUrl} size={28} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-ink">{b.name}</span>
                      <span className="block truncate text-[11px] text-ink-faint">
                        {b.department ?? b.code}
                      </span>
                    </span>
                    <Cake className="size-3.5 shrink-0 text-accent" aria-hidden />
                    <span className="tabular shrink-0 text-[11px] text-ink-faint">
                      {b.dateOfBirth
                        ? new Date(b.dateOfBirth).toLocaleDateString("en-GB", {
                            day: "2-digit",
                            month: "short",
                          })
                        : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      <p className="mt-4 flex items-center gap-1.5 text-[11px] text-ink-faint">
        <Clock className="size-3" aria-hidden />
        Everything on this page is your own record. Figures update the moment a request is decided.
      </p>
    </>
  );
}
