"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck, Settings2 } from "lucide-react";
import { bellSummary, markNotifications, type BellSummary } from "@/app/(app)/me/notifications/actions";
import { timeAgo } from "@/lib/time-ago";
import { cn } from "@/lib/utils";

/** How often an open tab asks for new notifications. */
const POLL_MS = 60_000;

const DOT: Record<string, string> = {
  info: "bg-info",
  success: "bg-ok",
  warning: "bg-warn",
  danger: "bg-danger",
};

/**
 * The bell in the header.
 *
 * It starts from the count the server rendered, so the badge is right on the
 * first paint, then refreshes every minute and whenever the tab comes back into
 * focus — the moment somebody returns to the app is exactly when they want to
 * know what arrived. Polling rather than a socket: the numbers here change on
 * a human timescale, and a poll needs no extra infrastructure to deploy.
 */
export function NotificationBell({ initial }: { initial: BellSummary }) {
  const router = useRouter();
  const [summary, setSummary] = useState(initial);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [, startTransition] = useTransition();
  const panel = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      setSummary(await bellSummary());
      setNow(Date.now());
    } catch {
      // a failed poll leaves the last good figure showing rather than a zero
    }
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && void refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  // close on an outside click or Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (panel.current && !panel.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = () => {
    setOpen((o) => !o);
    if (!open) void refresh();
  };

  const openItem = (id: string, href: string | null) => {
    // optimistic: the dot clears at once, the server catches up
    setSummary((s) => ({
      unread: Math.max(0, s.unread - (s.items.find((i) => i.id === id && !i.read) ? 1 : 0)),
      items: s.items.map((i) => (i.id === id ? { ...i, read: true } : i)),
    }));
    setOpen(false);
    startTransition(async () => {
      await markNotifications([id], "read");
      if (href) router.push(href);
    });
  };

  const markAll = () => {
    setSummary((s) => ({ unread: 0, items: s.items.map((i) => ({ ...i, read: true })) }));
    startTransition(async () => {
      await markNotifications("all", "read");
      router.refresh();
    });
  };

  const badge = summary.unread > 99 ? "99+" : String(summary.unread);

  return (
    <div className="relative" ref={panel}>
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={summary.unread ? `Notifications, ${summary.unread} unread` : "Notifications"}
        className="relative rounded p-1.5 text-ink-soft hover:bg-sunk hover:text-ink"
      >
        <Bell className="size-4" />
        {summary.unread > 0 ? (
          <span className="tabular absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] leading-4 font-semibold text-white">
            {badge}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 z-50 mt-2 w-[22rem] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-md border border-line bg-surface shadow-xl"
        >
          <header className="flex items-center justify-between border-b border-line px-3 py-2">
            <p className="text-sm font-semibold text-ink">
              Notifications
              {summary.unread ? <span className="ml-1.5 text-xs font-normal text-ink-faint">{summary.unread} unread</span> : null}
            </p>
            <div className="flex items-center gap-1">
              {summary.unread > 0 ? (
                <button
                  type="button"
                  onClick={markAll}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs text-ink-soft hover:bg-sunk hover:text-ink"
                >
                  <CheckCheck className="size-3.5" />
                  Mark all read
                </button>
              ) : null}
              <Link
                href="/me/notifications#preferences"
                onClick={() => setOpen(false)}
                className="rounded p-1 text-ink-faint hover:bg-sunk hover:text-ink"
                aria-label="Notification preferences"
                title="Preferences"
              >
                <Settings2 className="size-3.5" />
              </Link>
            </div>
          </header>

          {summary.items.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <Bell className="mx-auto size-6 text-ink-faint/60" aria-hidden />
              <p className="mt-2 text-sm text-ink-soft">You&rsquo;re all caught up</p>
              <p className="text-xs text-ink-faint">Approvals, decisions and reminders will appear here.</p>
            </div>
          ) : (
            <ul className="max-h-[26rem] divide-y divide-line-soft overflow-y-auto">
              {summary.items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => openItem(item.id, item.href)}
                    className={cn(
                      "flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-sunk",
                      !item.read && "bg-accent-soft/30",
                    )}
                  >
                    <span
                      className={cn("mt-1.5 size-2 shrink-0 rounded-full", item.read ? "bg-transparent" : DOT[item.severity] ?? "bg-accent")}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className={cn("block text-sm leading-snug", item.read ? "text-ink-soft" : "font-medium text-ink")}>
                        {item.title}
                      </span>
                      {item.body ? <span className="mt-0.5 line-clamp-2 block text-xs text-ink-faint">{item.body}</span> : null}
                      <span className="mt-1 block text-[11px] text-ink-faint" suppressHydrationWarning>
                        {timeAgo(item.createdAt, now)}
                        {item.actorLabel ? ` · ${item.actorLabel}` : ""}
                        {!item.read ? <span className="sr-only"> · unread</span> : null}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <footer className="border-t border-line px-3 py-2 text-center">
            <Link href="/me/notifications" onClick={() => setOpen(false)} className="text-xs font-medium text-accent hover:underline">
              View all notifications
            </Link>
          </footer>
        </div>
      ) : null}
    </div>
  );
}
