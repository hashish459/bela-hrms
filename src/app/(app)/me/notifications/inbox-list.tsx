"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Check, CheckCheck, Circle, ExternalLink } from "lucide-react";
import { Badge, Button, EmptyState } from "@/components/ui";
import { timeAgo } from "@/lib/time-ago";
import { cn } from "@/lib/utils";
import { markNotifications } from "./actions";

export type InboxItem = {
  id: string;
  title: string;
  body: string | null;
  href: string | null;
  severity: string;
  category: string;
  categoryLabel: string;
  actorLabel: string | null;
  createdAt: string;
  read: boolean;
  archived: boolean;
};

const DOT: Record<string, string> = { info: "bg-info", success: "bg-ok", warning: "bg-warn", danger: "bg-danger" };

/**
 * The inbox list: select, then act on the selection or on one row. Changes
 * show at once and the server re-renders behind them, so a click never waits
 * on a round trip to look done.
 */
export function InboxList({ items, archivedView }: { items: InboxItem[]; archivedView: boolean }) {
  // the reference time for "3h ago", fixed for the life of the page
  const [now] = useState(() => Date.now());
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [local, setLocal] = useState<Record<string, Partial<InboxItem>>>({});
  const [pending, startTransition] = useTransition();

  const view = items.map((i) => ({ ...i, ...local[i.id] }));
  const allSelected = view.length > 0 && selected.size === view.length;

  const act = (ids: string[], change: "read" | "unread" | "archive" | "restore") => {
    setLocal((l) => {
      const next = { ...l };
      for (const id of ids) {
        next[id] = {
          ...next[id],
          ...(change === "read" ? { read: true } : change === "unread" ? { read: false } : { archived: change === "archive", read: true }),
        };
      }
      return next;
    });
    setSelected(new Set());
    startTransition(async () => {
      await markNotifications(ids, change);
      router.refresh();
    });
  };

  if (view.length === 0) {
    return (
      <EmptyState
        title={archivedView ? "Nothing archived" : "You're all caught up"}
        hint={archivedView ? "Archived notifications stay here until you restore them." : "Approvals, decisions and reminders will appear here."}
      />
    );
  }

  const ids = [...selected];
  return (
    <div aria-busy={pending}>
      <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-3 py-2">
        <label className="inline-flex items-center gap-2 text-xs text-ink-soft">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={() => setSelected(allSelected ? new Set() : new Set(view.map((i) => i.id)))}
            className="size-4 accent-[var(--color-accent)]"
            aria-label="Select all on this page"
          />
          {selected.size ? `${selected.size} selected` : "Select"}
        </label>
        {selected.size ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <Button type="button" variant="secondary" className="px-2 py-1 text-xs" onClick={() => act(ids, "read")}>
              <Check className="size-3.5" /> Mark read
            </Button>
            <Button type="button" variant="secondary" className="px-2 py-1 text-xs" onClick={() => act(ids, "unread")}>
              <Circle className="size-3.5" /> Mark unread
            </Button>
            {archivedView ? (
              <Button type="button" variant="secondary" className="px-2 py-1 text-xs" onClick={() => act(ids, "restore")}>
                <ArchiveRestore className="size-3.5" /> Restore
              </Button>
            ) : (
              <Button type="button" variant="secondary" className="px-2 py-1 text-xs" onClick={() => act(ids, "archive")}>
                <Archive className="size-3.5" /> Archive
              </Button>
            )}
          </div>
        ) : null}
        {!archivedView && view.some((i) => !i.read) ? (
          <Button
            type="button"
            variant="ghost"
            className="ml-auto px-2 py-1 text-xs"
            onClick={() => {
              setLocal(Object.fromEntries(view.map((i) => [i.id, { read: true }])));
              startTransition(async () => {
                await markNotifications("all", "read");
                router.refresh();
              });
            }}
          >
            <CheckCheck className="size-3.5" /> Mark everything read
          </Button>
        ) : null}
      </div>

      <ul className="divide-y divide-line-soft">
        {view.map((item) => {
          const hidden = item.archived !== archivedView;
          return (
            <li
              key={item.id}
              className={cn("group flex items-start gap-3 px-3 py-3 transition-colors", !item.read && "bg-accent-soft/25", hidden && "opacity-40")}
            >
              <input
                type="checkbox"
                checked={selected.has(item.id)}
                onChange={() =>
                  setSelected((s) => {
                    const next = new Set(s);
                    if (next.has(item.id)) next.delete(item.id);
                    else next.add(item.id);
                    return next;
                  })
                }
                className="mt-1 size-4 shrink-0 accent-[var(--color-accent)]"
                aria-label={`Select “${item.title}”`}
              />
              <span className={cn("mt-2 size-2 shrink-0 rounded-full", item.read ? "bg-line" : DOT[item.severity] ?? "bg-accent")} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  {item.href ? (
                    <Link
                      href={item.href}
                      onClick={() => !item.read && act([item.id], "read")}
                      className={cn("text-sm hover:text-accent hover:underline", item.read ? "text-ink-soft" : "font-semibold text-ink")}
                    >
                      {item.title}
                    </Link>
                  ) : (
                    <span className={cn("text-sm", item.read ? "text-ink-soft" : "font-semibold text-ink")}>{item.title}</span>
                  )}
                  <Badge>{item.categoryLabel}</Badge>
                </div>
                {item.body ? <p className="mt-0.5 text-sm whitespace-pre-line text-ink-soft">{item.body}</p> : null}
                <p className="mt-1 text-[11px] text-ink-faint">
                  <time
                    dateTime={item.createdAt}
                    title={new Date(item.createdAt).toLocaleString("en-GB")}
                    // server and browser clocks can straddle a minute boundary
                    suppressHydrationWarning
                  >
                    {timeAgo(item.createdAt, now)}
                  </time>
                  {item.actorLabel ? ` · ${item.actorLabel}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-0.5 opacity-60 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                {item.href ? (
                  <Link href={item.href} className="rounded p-1.5 text-ink-faint hover:bg-sunk hover:text-ink" aria-label="Open" title="Open">
                    <ExternalLink className="size-3.5" />
                  </Link>
                ) : null}
                <button
                  type="button"
                  onClick={() => act([item.id], item.read ? "unread" : "read")}
                  className="rounded p-1.5 text-ink-faint hover:bg-sunk hover:text-ink"
                  aria-label={item.read ? "Mark unread" : "Mark read"}
                  title={item.read ? "Mark unread" : "Mark read"}
                >
                  {item.read ? <Circle className="size-3.5" /> : <Check className="size-3.5" />}
                </button>
                <button
                  type="button"
                  onClick={() => act([item.id], archivedView ? "restore" : "archive")}
                  className="rounded p-1.5 text-ink-faint hover:bg-sunk hover:text-ink"
                  aria-label={archivedView ? "Restore" : "Archive"}
                  title={archivedView ? "Restore" : "Archive"}
                >
                  {archivedView ? <ArchiveRestore className="size-3.5" /> : <Archive className="size-3.5" />}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
