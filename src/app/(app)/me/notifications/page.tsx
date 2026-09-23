import Link from "next/link";
import { requirePermission } from "@/lib/session";
import { OffsetPagination } from "@/components/pagination";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { cn } from "@/lib/utils";
import { CATALOGUE, CATEGORIES, type Category } from "@/modules/notifications/catalogue";
import { inbox, preferencesFor } from "@/modules/notifications/service";
import { savePreferences } from "./actions";
import { InboxList } from "./inbox-list";
import { SaveButton } from "./save-button";

export const metadata = { title: "Notifications" };

const VIEWS = [
  { key: "all", label: "Inbox" },
  { key: "unread", label: "Unread" },
  { key: "archived", label: "Archived" },
] as const;

export default async function NotificationsPage({ searchParams }: PageProps<"/me/notifications">) {
  const viewer = await requirePermission("self.desk.view");
  const params = await searchParams;

  const view = VIEWS.find((v) => v.key === params.view)?.key ?? "all";
  const category = CATEGORIES.find((c) => c.key === params.cat)?.key ?? null;
  const page = typeof params.page === "string" ? params.page : null;

  const [{ rows, page: pager, byCategory }, prefs] = await Promise.all([
    inbox(viewer.userId, { view, category, page }),
    preferencesFor(viewer.userId),
  ]);
  const unreadTotal = Object.values(byCategory).reduce((a, b) => a + b, 0);
  const label = new Map(CATEGORIES.map((c) => [c.key, c.label]));

  const href = (next: { view?: string; cat?: string | null }) => {
    const q = new URLSearchParams();
    const v = next.view ?? view;
    const c = next.cat === undefined ? category : next.cat;
    if (v !== "all") q.set("view", v);
    if (c) q.set("cat", c);
    const s = q.toString();
    return s ? `/me/notifications?${s}` : "/me/notifications";
  };

  // which channels a category can arrive by at all, from the catalogue
  const sendsEmail = (key: Category) => CATALOGUE.some((e) => e.category === key && e.email);

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Requests waiting on you, decisions on your own, reminders and announcements — in one place."
      />

      <div className="grid gap-4 lg:grid-cols-[13rem_1fr]">
        <nav aria-label="Notification folders" className="flex flex-col gap-3">
          <ul className="flex gap-1 lg:flex-col">
            {VIEWS.map((v) => (
              <li key={v.key}>
                <Link
                  href={href({ view: v.key })}
                  className={cn(
                    "flex items-center justify-between rounded px-2.5 py-1.5 text-sm",
                    view === v.key ? "bg-accent-soft font-medium text-accent" : "text-ink-soft hover:bg-sunk hover:text-ink",
                  )}
                >
                  {v.label}
                  {v.key !== "archived" && unreadTotal ? (
                    <span className="tabular ml-3 text-xs text-ink-faint">{unreadTotal}</span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
          <div>
            <p className="px-2.5 pb-1 text-[11px] font-medium tracking-wide text-ink-faint uppercase">Categories</p>
            <ul className="flex flex-wrap gap-1 lg:flex-col">
              <li>
                <Link
                  href={href({ cat: null })}
                  className={cn(
                    "block rounded px-2.5 py-1.5 text-sm",
                    !category ? "bg-sunk font-medium text-ink" : "text-ink-soft hover:bg-sunk hover:text-ink",
                  )}
                >
                  Everything
                </Link>
              </li>
              {CATEGORIES.map((c) => (
                <li key={c.key}>
                  <Link
                    href={href({ cat: c.key })}
                    className={cn(
                      "flex items-center justify-between rounded px-2.5 py-1.5 text-sm",
                      category === c.key ? "bg-sunk font-medium text-ink" : "text-ink-soft hover:bg-sunk hover:text-ink",
                    )}
                  >
                    {c.label}
                    {byCategory[c.key] ? (
                      <span className="tabular ml-3 rounded-full bg-accent-soft px-1.5 text-[10px] font-semibold text-accent">
                        {byCategory[c.key]}
                      </span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </nav>

        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <InboxList
              archivedView={view === "archived"}
              items={rows.map((r) => ({
                id: r.id,
                title: r.title,
                body: r.body,
                href: r.href,
                severity: r.severity,
                category: r.category,
                categoryLabel: label.get(r.category as Category) ?? r.category,
                actorLabel: r.actorLabel,
                createdAt: r.createdAt.toISOString(),
                read: r.readAt !== null,
                archived: r.archivedAt !== null,
              }))}
            />
            <OffsetPagination page={pager} params={params} label="notifications" />
          </Card>

          <Card id="preferences">
            <CardHeader
              title="Preferences"
              description="Choose how each kind of notification reaches you. Email goes to the address on your account."
            />
            <form action={savePreferences}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] tracking-wide text-ink-faint uppercase">
                    <th className="px-4 py-2 font-medium">Category</th>
                    <th className="w-24 px-4 py-2 text-center font-medium">In app</th>
                    <th className="w-24 px-4 py-2 text-center font-medium">Email</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-soft border-t border-line-soft">
                  {CATEGORIES.map((c) => {
                    const pref = prefs.get(c.key) ?? { inApp: true, email: true };
                    const email = sendsEmail(c.key);
                    return (
                      <tr key={c.key}>
                        <td className="px-4 py-2.5">
                          <p className="font-medium text-ink">{c.label}</p>
                          <p className="text-xs text-ink-faint">{c.description}</p>
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <input
                            type="checkbox"
                            name={`${c.key}.inApp`}
                            defaultChecked={pref.inApp}
                            aria-label={`${c.label} in app`}
                            className="size-4 accent-[var(--color-accent)]"
                          />
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <input
                            type="checkbox"
                            name={`${c.key}.email`}
                            defaultChecked={pref.email}
                            aria-label={`${c.label} by email`}
                            className="size-4 accent-[var(--color-accent)]"
                            title={email ? undefined : "Your organisation does not send these by email at the moment"}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="flex items-center justify-between gap-3 border-t border-line-soft px-4 py-3">
                <p className="text-xs text-ink-faint">
                  Your organisation decides which notifications exist and whether they use email; these choices can only turn
                  them down for you.
                </p>
                <SaveButton>Save preferences</SaveButton>
              </div>
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}
