"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePersisted, writePersisted } from "@/lib/persisted";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as Icons from "lucide-react";
import { cn } from "@/lib/utils";

export type NavItem = {
  id: string;
  label: string;
  href: string;
  icon?: string;
  status: "ready" | "planned";
  section?: string | null;
  description?: string;
};
export type NavSection = { label: string | null; items: NavItem[] };
export type NavModule = {
  id: string;
  label: string;
  icon: string;
  summary?: string;
  sections: NavSection[];
};

/**
 * Which modules are open, oldest first.
 *
 * A list, not the map this used to be: capping the sidebar at two open modules
 * requires knowing which was opened *first*, and object key order is not a
 * contract worth relying on. The key is versioned so an existing browser holding
 * the old `{id: boolean}` shape starts clean rather than being parsed as an
 * array of nothing.
 */
const STORAGE_KEY = "bela-hrms.nav.open.v2";

/** At most this many modules stay open; opening another closes the oldest. */
export const MAX_OPEN_MODULES = 2;

function readOpen(): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Opens `id`, evicting the least recently opened module once the cap is reached.
 *
 * Pure, and exported, because "which one closes" is the whole of the behaviour
 * and it should be assertable without a browser.
 *
 *   open([], "a")           → ["a"]
 *   open(["a"], "b")        → ["a", "b"]
 *   open(["a","b"], "c")    → ["b", "c"]     — "a", opened first, closes
 *   open(["a","b"], "a")    → ["b", "a"]     — re-opening promotes, evicts nothing
 */
export function openModule(current: string[], id: string, cap = MAX_OPEN_MODULES): string[] {
  const without = current.filter((m) => m !== id);
  return [...without, id].slice(-cap);
}

export function closeModule(current: string[], id: string): string[] {
  return current.filter((m) => m !== id);
}

export function Icon({ name, className }: { name?: string; className?: string }) {
  const Cmp =
    (name ? (Icons as unknown as Record<string, Icons.LucideIcon>)[name] : undefined) ?? Icons.Circle;
  return <Cmp className={className} aria-hidden />;
}

/** The module a path belongs to, and the item itself. */
export function locate(modules: NavModule[], pathname: string) {
  let best: { module: NavModule; section: NavSection; item: NavItem } | null = null;
  for (const m of modules) {
    for (const s of m.sections) {
      for (const item of s.items) {
        const exact = pathname === item.href;
        const nested = pathname.startsWith(item.href + "/");
        if (!exact && !nested) continue;
        // deepest href wins, so /hr/employees/new maps to Employees, not a prefix
        if (!best || item.href.length > best.item.href.length) {
          best = { module: m, section: s, item };
        }
      }
    }
  }
  return best;
}

export function SidebarNav({
  modules,
  railed,
  onUnrail,
  onNavigate,
  counts,
}: {
  modules: NavModule[];
  railed: boolean;
  onUnrail: () => void;
  onNavigate: () => void;
  /** Live figures shown against a nav item, keyed by item id. */
  counts?: Record<string, number>;
}) {
  const pathname = usePathname();
  const active = useMemo(() => locate(modules, pathname), [modules, pathname]);
  const activeModuleId = active?.module.id ?? null;

  // Which modules are open is a browser preference, read through an external
  // store so the server render and the first client render agree. The module
  // holding the current route is open unless it was explicitly collapsed.
  const openRaw = usePersisted(STORAGE_KEY);
  const open = useMemo<string[]>(() => {
    if (openRaw === null) return activeModuleId ? [activeModuleId] : [];
    try {
      const parsed = JSON.parse(openRaw) as unknown;
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
    } catch {
      return [];
    }
  }, [openRaw, activeModuleId]);

  const setOpen = (next: string[]) => writePersisted(STORAGE_KEY, JSON.stringify(next));
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // "/" focuses the nav search, Escape leaves it — the shortcut people expect in
  // an app with this many screens. Ignored while typing somewhere else.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      const typing =
        el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "Escape" && el === searchRef.current) {
        setQuery("");
        searchRef.current?.blur();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Open the module you have just navigated *into* — but only on arrival.
  //
  // Keying this on `expanded` as well meant collapsing the module you were
  // already inside re-opened it immediately: the click wrote `false`, the effect
  // saw a closed active module and wrote `true` straight back. Remembering which
  // module was last auto-opened makes it fire once per navigation, so the header
  // stays closable while you are standing in it.
  const autoOpened = useRef<string | null>(activeModuleId);
  useEffect(() => {
    if (!activeModuleId || autoOpened.current === activeModuleId) return;
    autoOpened.current = activeModuleId;
    const current = readOpen();
    if (current.includes(activeModuleId)) return;
    // Navigating into a module counts as opening it, so it obeys the same cap —
    // otherwise walking through four modules would leave all four open.
    writePersisted(STORAGE_KEY, JSON.stringify(openModule(current, activeModuleId)));
  }, [activeModuleId]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return modules;
    return modules
      .map((m) => ({
        ...m,
        sections: m.sections
          .map((s) => ({
            ...s,
            items: s.items.filter(
              (i) =>
                i.label.toLowerCase().includes(q) ||
                m.label.toLowerCase().includes(q) ||
                (s.label ?? "").toLowerCase().includes(q),
            ),
          }))
          .filter((s) => s.items.length > 0),
      }))
      .filter((m) => m.sections.length > 0);
  }, [modules, q]);

  const searching = q.length > 0;
  const totalHits = filtered.reduce(
    (a, m) => a + m.sections.reduce((b, s) => b + s.items.length, 0),
    0,
  );

  /* ------------------------------------------------------------------ rail */

  if (railed) {
    return (
      <nav aria-label="Modules" className="flex flex-col items-center gap-1 px-1.5 py-3">
        <Link
          href="/dashboard"
          onClick={onNavigate}
          title="Dashboard"
          className={cn(
            "grid size-9 place-items-center rounded",
            pathname === "/dashboard"
              ? "bg-accent-soft text-accent"
              : "text-ink-soft hover:bg-sunk hover:text-ink",
          )}
        >
          <Icons.LayoutDashboard className="size-4" />
        </Link>

        <span className="my-1 h-px w-6 bg-line" aria-hidden />

        {modules.map((m) => {
          const isActive = m.id === activeModuleId;
          const pending = m.sections
            .flatMap((s) => s.items)
            .reduce((a, i) => a + (counts?.[i.id] ?? 0), 0);
          return (
            <button
              key={m.id}
              type="button"
              title={m.label}
              aria-label={`${m.label} — expand navigation`}
              onClick={() => {
                setOpen(openModule(open, m.id));
                onUnrail();
              }}
              className={cn(
                "relative grid size-9 place-items-center rounded",
                isActive
                  ? "bg-accent-soft text-accent"
                  : "text-ink-soft hover:bg-sunk hover:text-ink",
              )}
            >
              <Icon name={m.icon} className="size-4" />
              {pending > 0 ? (
                <span
                  className="absolute top-1 right-1 size-1.5 rounded-full bg-warn"
                  aria-hidden
                />
              ) : null}
            </button>
          );
        })}
      </nav>
    );
  }

  /* ---------------------------------------------------------------- full */

  return (
    <nav aria-label="Main navigation" className="flex h-full flex-col">
      <div className="px-2 pt-3 pb-2">
        <div className="relative">
          <Icons.Search
            className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-ink-faint"
            aria-hidden
          />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a screen"
            aria-label="Find a screen"
            className="w-full rounded border border-line bg-ground py-1.5 pr-8 pl-7 text-xs text-ink placeholder:text-ink-faint"
          />
          {!query ? (
            <kbd
              className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border border-line px-1 font-mono text-[10px] leading-4 text-ink-faint"
              aria-hidden
            >
              /
            </kbd>
          ) : null}
        </div>
        {searching ? (
          <p className="px-0.5 pt-1.5 text-[11px] text-ink-faint">
            {totalHits} {totalHits === 1 ? "screen" : "screens"} match
          </p>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <Link
          href="/dashboard"
          onClick={onNavigate}
          className={cn(
            "mb-2 flex items-center gap-2 rounded px-2 py-1.5 text-sm",
            pathname === "/dashboard"
              ? "bg-accent-soft font-medium text-accent"
              : "text-ink-soft hover:bg-sunk hover:text-ink",
          )}
        >
          <Icons.LayoutDashboard className="size-4 shrink-0" />
          Dashboard
        </Link>

        <ul className="flex flex-col gap-0.5">
          {filtered.map((m) => {
            const isOpen = searching || open.includes(m.id);
            const holdsActive = m.id === activeModuleId;
            const items = m.sections.flatMap((s) => s.items);
            const ready = items.filter((i) => i.status === "ready").length;
            const pending = items.reduce((a, i) => a + (counts?.[i.id] ?? 0), 0);
            const panelId = `nav-${m.id}`;

            return (
              <li key={m.id}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => {
                    if (searching) return;
                    // Opening a third module closes the one opened longest ago,
                    // so the tree never grows past two expanded sections.
                    setOpen(isOpen ? closeModule(open, m.id) : openModule(open, m.id));
                  }}
                  className={cn(
                    "group flex w-full items-center gap-2 rounded px-2 py-1.5 text-left",
                    holdsActive
                      ? "text-ink"
                      : "text-ink-soft hover:bg-sunk hover:text-ink",
                    isOpen && !holdsActive ? "text-ink" : "",
                  )}
                >
                  <Icon
                    name={m.icon}
                    className={cn("size-4 shrink-0", holdsActive ? "text-accent" : "")}
                  />
                  <span className="flex-1 truncate text-[13px] font-medium">{m.label}</span>

                  {pending > 0 ? (
                    <span className="tabular rounded-full bg-warn-soft px-1.5 text-[10px] leading-4 font-medium text-warn">
                      {pending}
                    </span>
                  ) : ready === 0 ? (
                    <span className="rounded bg-sunk px-1 text-[9px] leading-4 font-medium tracking-wide text-ink-faint uppercase">
                      soon
                    </span>
                  ) : null}

                  <Icons.ChevronRight
                    className={cn(
                      "size-3.5 shrink-0 text-ink-faint transition-transform duration-150",
                      isOpen ? "rotate-90" : "",
                    )}
                    aria-hidden
                  />
                </button>

                {/* 0fr → 1fr animates height without measuring it */}
                <div
                  id={panelId}
                  className="grid transition-[grid-template-rows] duration-150 ease-out"
                  style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}
                >
                  <div className="overflow-hidden">
                    <div className="mt-0.5 mb-1.5 ml-4 border-l border-line pl-2">
                      {m.sections.map((section, si) => (
                        <div key={`${m.id}:${section.label ?? "_"}:${si}`}>
                          {section.label ? (
                            <p
                              className={cn(
                                "px-2 pb-0.5 text-[10px] font-medium tracking-wider text-ink-faint/80 uppercase",
                                si > 0 ? "pt-2" : "pt-1",
                              )}
                            >
                              {section.label}
                            </p>
                          ) : null}
                          <ul className="flex flex-col gap-0.5">
                            {section.items.map((item) => {
                              const isCurrent = active?.item.id === item.id;
                              const count = counts?.[item.id] ?? 0;
                              return (
                                <li key={item.id}>
                                  <Link
                                    href={item.href}
                                    onClick={onNavigate}
                                    aria-current={isCurrent ? "page" : undefined}
                                    title={item.description}
                                    className={cn(
                                      "relative flex items-center gap-2 rounded px-2 py-1.5 text-[13px]",
                                      isCurrent
                                        ? "bg-accent-soft font-medium text-accent"
                                        : item.status === "planned"
                                          ? "text-ink-faint hover:bg-sunk hover:text-ink-soft"
                                          : "text-ink-soft hover:bg-sunk hover:text-ink",
                                    )}
                                  >
                                    {isCurrent ? (
                                      <span
                                        className="absolute -left-2.5 h-4 w-0.5 rounded-full bg-accent"
                                        aria-hidden
                                      />
                                    ) : null}
                                    <Icon name={item.icon} className="size-3.5 shrink-0" />
                                    <span className="flex-1 truncate">{item.label}</span>
                                    {count > 0 ? (
                                      <span className="tabular rounded-full bg-warn-soft px-1.5 text-[10px] leading-4 font-medium text-warn">
                                        {count}
                                      </span>
                                    ) : item.status === "planned" ? (
                                      <span className="rounded bg-sunk px-1 text-[9px] leading-4 font-medium tracking-wide text-ink-faint uppercase">
                                        soon
                                      </span>
                                    ) : null}
                                  </Link>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        {filtered.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-ink-faint">
            {searching ? `Nothing matches “${query}”.` : "No modules are available for your role."}
          </p>
        ) : null}
      </div>
    </nav>
  );
}

/** Module › Section › Screen, above the page title. */
export function Breadcrumb({ modules }: { modules: NavModule[] }) {
  const pathname = usePathname();
  const active = useMemo(() => locate(modules, pathname), [modules, pathname]);
  if (!active) return null;

  const parts = [active.module.label, active.section.label, active.item.label].filter(
    Boolean,
  ) as string[];

  return (
    <nav aria-label="Breadcrumb" className="mb-3">
      <ol className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink-faint">
        <li>
          <Link href="/dashboard" className="hover:text-ink-soft">
            Home
          </Link>
        </li>
        {parts.map((p, i) => (
          <li key={`${p}-${i}`} className="flex items-center gap-1.5">
            <Icons.ChevronRight className="size-3" aria-hidden />
            <span className={i === parts.length - 1 ? "text-ink-soft" : undefined}>{p}</span>
          </li>
        ))}
      </ol>
    </nav>
  );
}
