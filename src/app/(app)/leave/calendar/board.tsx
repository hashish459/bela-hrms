"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, GanttChartSquare, PartyPopper, Search, Users, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type BoardDay = {
  date: string;
  bsDay: number;
  adDay: number;
  adMonth: string;
  weekday: number;
  holiday: string | null;
};

export type BoardAbsence = {
  id: string;
  reference: string;
  employeeId: string;
  code: string;
  name: string;
  department: string | null;
  from: string;
  to: string;
  status: "approved" | "pending";
  typeName: string;
  colour: string;
  days: string;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const fill = (a: { status: string; colour: string }) =>
  a.status === "approved"
    ? { background: a.colour }
    : { backgroundImage: `repeating-linear-gradient(45deg, ${a.colour}, ${a.colour} 3px, ${a.colour}33 3px, ${a.colour}33 6px)` };

/**
 * Who is away, as a month grid (a wall calendar) or a timeline (one lane per
 * person). Filtering and the day detail are local — a month of absences is a
 * few dozen rows — so moving around it never waits on the server.
 */
export function LeaveBoard({
  days,
  absences,
  today,
  monthLabel,
}: {
  days: BoardDay[];
  absences: BoardAbsence[];
  today: string;
  monthLabel: string;
}) {
  const [view, setView] = useState<"month" | "timeline">("month");
  const [q, setQ] = useState("");
  const [dept, setDept] = useState<string>("");
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [showPending, setShowPending] = useState(true);
  const inMonth = days.some((d) => d.date === today);
  const [selected, setSelected] = useState<string>(inMonth ? today : days[0].date);

  const types = useMemo(() => {
    const m = new Map<string, { name: string; colour: string; n: number }>();
    for (const a of absences) m.set(a.typeName, { name: a.typeName, colour: a.colour, n: (m.get(a.typeName)?.n ?? 0) + 1 });
    return [...m.values()];
  }, [absences]);
  const departments = useMemo(() => [...new Set(absences.map((a) => a.department ?? "No department"))].sort(), [absences]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return absences.filter(
      (a) =>
        !hiddenTypes.has(a.typeName) &&
        (showPending || a.status === "approved") &&
        (!dept || (a.department ?? "No department") === dept) &&
        (!needle || a.name.toLowerCase().includes(needle) || a.code.toLowerCase().includes(needle)),
    );
  }, [absences, hiddenTypes, showPending, dept, q]);

  const awayOn = useMemo(() => {
    const m = new Map<string, BoardAbsence[]>();
    for (const d of days) m.set(d.date, []);
    for (const a of shown) for (const d of days) if (d.date >= a.from && d.date <= a.to) m.get(d.date)!.push(a);
    return m;
  }, [shown, days]);

  const selectedDay = days.find((d) => d.date === selected) ?? days[0];
  const selectedAway = awayOn.get(selectedDay.date) ?? [];
  const maxAway = Math.max(1, ...[...awayOn.values()].map((l) => l.length));

  const moveSelection = (delta: number) => {
    const i = days.findIndex((d) => d.date === selected);
    const next = days[Math.min(days.length - 1, Math.max(0, i + delta))];
    setSelected(next.date);
    document.getElementById(`day-${next.date}`)?.focus();
  };

  return (
    <div className="flex flex-col gap-4">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface p-2.5" data-print-hide>
        <div className="flex rounded-md border border-line p-0.5" role="tablist" aria-label="View">
          {(
            [
              ["month", "Month", CalendarDays],
              ["timeline", "Timeline", GanttChartSquare],
            ] as const
          ).map(([k, label, I]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={view === k}
              onClick={() => setView(k)}
              className={cn(
                "flex items-center gap-1.5 rounded px-2.5 py-1 text-xs transition-colors",
                view === k ? "bg-accent text-on-accent" : "text-ink-soft hover:bg-sunk hover:text-ink",
              )}
            >
              <I className="size-3.5" aria-hidden />
              {label}
            </button>
          ))}
        </div>
        <label className="relative min-w-44 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-faint" aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find a person"
            aria-label="Find a person"
            className="w-full rounded border border-line bg-surface py-1.5 pr-2.5 pl-8 text-sm text-ink placeholder:text-ink-faint"
          />
        </label>
        <select
          value={dept}
          onChange={(e) => setDept(e.target.value)}
          aria-label="Department"
          className="rounded border border-line bg-surface px-2.5 py-1.5 text-sm text-ink"
        >
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-ink-soft">
          <input type="checkbox" checked={showPending} onChange={(e) => setShowPending(e.target.checked)} className="accent-[var(--color-accent)]" />
          Include pending
        </label>
      </div>

      {/* type legend doubles as a filter */}
      {types.length ? (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Leave types">
          {types.map((t) => {
            const off = hiddenTypes.has(t.name);
            return (
              <button
                key={t.name}
                type="button"
                aria-pressed={!off}
                onClick={() =>
                  setHiddenTypes((s) => {
                    const n = new Set(s);
                    if (n.has(t.name)) n.delete(t.name);
                    else n.add(t.name);
                    return n;
                  })
                }
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-opacity",
                  off ? "border-line text-ink-faint opacity-50" : "border-line bg-surface text-ink-soft hover:bg-sunk",
                )}
              >
                <span className="size-2.5 rounded-full" style={{ background: t.colour }} aria-hidden />
                {t.name}
                <span className="tabular text-ink-faint">{t.n}</span>
              </button>
            );
          })}
          <span className="ml-2 flex items-center gap-1.5 text-[11px] text-ink-faint">
            <span className="h-2.5 w-4 rounded-sm" style={fill({ status: "pending", colour: "#6b7280" })} aria-hidden />
            Pending
          </span>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1fr_20rem]">
        {view === "month" ? (
          <section className="overflow-hidden rounded-md border border-line bg-surface" aria-label={`${monthLabel} calendar`}>
            <div className="grid grid-cols-7 border-b border-line bg-sunk">
              {WEEKDAYS.map((w, i) => (
                <div key={w} className={cn("px-2 py-2 text-center text-[11px] font-medium tracking-wide uppercase", i === 6 ? "text-danger" : "text-ink-faint")}>
                  {w}
                </div>
              ))}
            </div>
            <div
              className="grid grid-cols-7"
              role="grid"
              onKeyDown={(e) => {
                const map: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 7, ArrowUp: -7 };
                if (map[e.key] !== undefined) {
                  e.preventDefault();
                  moveSelection(map[e.key]);
                }
              }}
            >
              {Array.from({ length: days[0].weekday }, (_, i) => (
                <div key={`pad-${i}`} className="min-h-28 border-r border-b border-line-soft bg-sunk/40" aria-hidden />
              ))}
              {days.map((d) => {
                const list = awayOn.get(d.date) ?? [];
                const off = d.weekday === 6 || Boolean(d.holiday);
                const isToday = d.date === today;
                const isSel = d.date === selected;
                return (
                  <button
                    key={d.date}
                    id={`day-${d.date}`}
                    type="button"
                    role="gridcell"
                    aria-selected={isSel}
                    tabIndex={isSel ? 0 : -1}
                    onClick={() => setSelected(d.date)}
                    aria-label={`${d.bsDay} ${monthLabel}${d.holiday ? `, ${d.holiday}` : ""}: ${list.length} away`}
                    className={cn(
                      "group relative flex min-h-28 flex-col gap-1 border-r border-b border-line-soft p-1.5 text-left transition-colors [&:nth-child(7n)]:border-r-0",
                      off ? "bg-danger-soft/25" : "bg-surface",
                      isSel ? "z-[1] ring-2 ring-accent ring-inset" : "hover:bg-sunk/60",
                    )}
                  >
                    <span className="flex items-start justify-between">
                      <span
                        className={cn(
                          "tabular grid size-7 place-items-center rounded-full text-sm font-semibold",
                          isToday ? "bg-accent text-on-accent" : off ? "text-danger" : "text-ink",
                        )}
                      >
                        {d.bsDay}
                      </span>
                      <span className="tabular text-[10px] text-ink-faint">
                        {d.adDay === 1 || d === days[0] ? `${d.adDay} ${d.adMonth}` : d.adDay}
                      </span>
                    </span>
                    {d.holiday ? <span className="line-clamp-1 text-[10px] font-medium text-danger">{d.holiday}</span> : null}
                    <span className="flex flex-col gap-0.5">
                      {list.slice(0, 3).map((a) => (
                        <span key={a.id} className="flex items-center gap-1 truncate rounded px-1 py-px text-[10px] text-ink" style={{ background: `${a.colour}1f` }}>
                          <span className="size-1.5 shrink-0 rounded-full" style={fill(a)} aria-hidden />
                          <span className="truncate">{a.name.split(" ")[0]}</span>
                        </span>
                      ))}
                      {list.length > 3 ? <span className="px-1 text-[10px] font-medium text-accent">+{list.length - 3} more</span> : null}
                    </span>
                    {list.length ? (
                      <span
                        className="absolute inset-x-1.5 bottom-1 h-0.5 rounded-full bg-accent/60"
                        style={{ width: `calc(${(list.length / maxAway) * 100}% - 0.75rem)` }}
                        aria-hidden
                      />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </section>
        ) : (
          <Timeline days={days} absences={shown} today={today} selected={selected} onSelect={setSelected} />
        )}

        {/* the selected day */}
        <aside className="flex flex-col gap-3 self-start rounded-md border border-line bg-surface xl:sticky xl:top-16">
          <header className="flex items-center justify-between gap-2 border-b border-line-soft px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-ink">
                {WEEKDAYS[selectedDay.weekday]}, {selectedDay.bsDay} {monthLabel}
              </p>
              <p className="text-[11px] text-ink-faint">
                {selectedDay.adDay} {selectedDay.adMonth}
                {selectedDay.date === today ? " · Today" : ""}
              </p>
            </div>
            <span className="flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
              <Users className="size-3.5" aria-hidden />
              {selectedAway.length}
            </span>
          </header>
          {selectedDay.holiday ? (
            <p className="mx-4 flex items-center gap-1.5 rounded bg-danger-soft px-2.5 py-1.5 text-xs text-danger">
              <PartyPopper className="size-3.5" aria-hidden />
              {selectedDay.holiday}
            </p>
          ) : selectedDay.weekday === 6 ? (
            <p className="mx-4 rounded bg-sunk px-2.5 py-1.5 text-xs text-ink-faint">Saturday — weekly off</p>
          ) : null}
          {selectedAway.length === 0 ? (
            <p className="px-4 pb-6 text-center text-xs text-ink-faint">Everybody is in.</p>
          ) : (
            <ul className="flex max-h-[28rem] flex-col divide-y divide-line-soft overflow-y-auto pb-1">
              {selectedAway.map((a) => (
                <li key={a.id} className="flex gap-2.5 px-4 py-2.5">
                  <span className="mt-0.5 w-1 shrink-0 rounded-full" style={fill(a)} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <Link href={`/hr/employees/${a.employeeId}`} className="block truncate text-sm font-medium text-ink hover:text-accent">
                      {a.name}
                    </Link>
                    <p className="truncate text-[11px] text-ink-faint">
                      {a.code}
                      {a.department ? ` · ${a.department}` : ""}
                    </p>
                    <p className="mt-0.5 text-[11px] text-ink-soft">
                      {a.typeName} · {a.days}d{a.status === "pending" ? <span className="ml-1 rounded bg-warn-soft px-1 text-warn">pending</span> : null}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <button type="button" onClick={() => setSelected(inMonth ? today : days[0].date)} className="mx-4 mb-3 flex items-center justify-center gap-1 rounded border border-line py-1 text-[11px] text-ink-soft hover:bg-sunk" data-print-hide>
            <X className="size-3" aria-hidden />
            Back to {inMonth ? "today" : "the 1st"}
          </button>
        </aside>
      </div>
    </div>
  );
}

function Timeline({
  days,
  absences,
  today,
  selected,
  onSelect,
}: {
  days: BoardDay[];
  absences: BoardAbsence[];
  today: string;
  selected: string;
  onSelect: (d: string) => void;
}) {
  const people = useMemo(() => {
    const m = new Map<string, { id: string; name: string; code: string; department: string | null; items: BoardAbsence[] }>();
    for (const a of absences) {
      const p = m.get(a.employeeId) ?? { id: a.employeeId, name: a.name, code: a.code, department: a.department, items: [] };
      p.items.push(a);
      m.set(a.employeeId, p);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [absences]);
  const index = new Map(days.map((d, i) => [d.date, i]));
  const cols = `repeat(${days.length}, minmax(1.6rem, 1fr))`;

  if (!people.length) {
    return <section className="grid place-items-center rounded-md border border-line bg-surface p-12 text-sm text-ink-faint">Nobody matches the filters.</section>;
  }

  return (
    <section className="overflow-x-auto rounded-md border border-line bg-surface" aria-label="Timeline">
      <div className="min-w-max">
        <div className="sticky top-0 z-[2] flex border-b border-line bg-sunk">
          <div className="sticky left-0 z-[3] w-52 shrink-0 bg-sunk px-3 py-2 text-[11px] font-medium tracking-wide text-ink-faint uppercase">Employee</div>
          <div className="grid flex-1" style={{ gridTemplateColumns: cols }}>
            {days.map((d) => (
              <button
                key={d.date}
                type="button"
                onClick={() => onSelect(d.date)}
                title={d.holiday ?? undefined}
                className={cn(
                  "flex flex-col items-center py-1 text-[10px] leading-tight",
                  d.weekday === 6 || d.holiday ? "text-danger" : "text-ink-soft",
                  d.date === selected && "bg-accent-soft",
                )}
              >
                <span className="opacity-70">{WEEKDAYS[d.weekday][0]}</span>
                <span className={cn("tabular font-semibold", d.date === today && "rounded-full bg-accent px-1 text-on-accent")}>{d.bsDay}</span>
              </button>
            ))}
          </div>
        </div>
        {people.map((p) => (
          <div key={p.id} className="group flex border-b border-line-soft last:border-b-0 hover:bg-sunk/40">
            <div className="sticky left-0 z-[1] w-52 shrink-0 bg-surface px-3 py-2 group-hover:bg-sunk">
              <Link href={`/hr/employees/${p.id}`} className="block truncate text-sm font-medium text-ink hover:text-accent">
                {p.name}
              </Link>
              <p className="truncate text-[10px] text-ink-faint">
                {p.code}
                {p.department ? ` · ${p.department}` : ""}
              </p>
            </div>
            <div className="relative grid flex-1" style={{ gridTemplateColumns: cols }}>
              {days.map((d, i) => (
                <span
                  key={d.date}
                  style={{ gridColumn: i + 1, gridRow: 1 }}
                  className={cn(
                    "border-l border-line-soft/60",
                    (d.weekday === 6 || d.holiday) && "bg-danger-soft/25",
                    d.date === today && "bg-accent-soft/60",
                  )}
                  aria-hidden
                />
              ))}
              {p.items.map((a) => {
                const start = index.get(a.from < days[0].date ? days[0].date : a.from)!;
                const end = index.get(a.to > days.at(-1)!.date ? days.at(-1)!.date : a.to)!;
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => onSelect(a.from < days[0].date ? days[0].date : a.from)}
                    title={`${a.typeName} · ${a.days} day(s) · ${a.status} · ${a.reference}`}
                    style={{ gridColumn: `${start + 1} / ${end + 2}`, gridRow: 1, ...fill(a) }}
                    className="z-[1] my-2 mx-0.5 flex h-6 items-center truncate rounded-md px-1.5 text-[10px] font-medium text-white shadow-sm ring-1 ring-black/5 hover:brightness-110"
                  >
                    <span className="truncate drop-shadow-sm">{a.typeName}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
