import Link from "next/link";
import { notFound } from "next/navigation";
import { Construction } from "lucide-react";
import { requirePermission } from "@/lib/session";
import { navItemForHref, visibleNavigation } from "@/modules/registry";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui";

export async function generateMetadata({ params }: PageProps<"/[module]/[[...rest]]">) {
  const { module, rest } = await params;
  const entry = navItemForHref("/" + [module, ...(rest ?? [])].join("/"));
  return { title: entry ? entry.item.label : "Not found" };
}

/**
 * Every screen that is declared in the registry but not built yet.
 *
 * Modules with real pages have their own folder, and Next resolves a static
 * segment ahead of this dynamic one — so only planned routes reach here. Anything
 * the registry does not know about still 404s, rather than showing a placeholder
 * for a URL somebody mistyped.
 */
export default async function PlannedScreen({ params }: PageProps<"/[module]/[[...rest]]">) {
  const { module, rest } = await params;
  const href = "/" + [module, ...(rest ?? [])].join("/");

  const entry = navItemForHref(href);
  if (!entry || entry.item.status !== "planned") notFound();

  const viewer = await requirePermission(entry.item.permission);
  const { item, module: mod } = entry;

  // the rest of this module, so somebody landing here can see the shape of it
  const siblings = visibleNavigation(viewer.permissions, { hasEmployee: !!viewer.employeeId }).find((m) => m.id === mod.id);

  return (
    <>
      <PageHeader
        title={item.label}
        description={mod.label}
        action={<Badge tone="warn">Planned</Badge>}
      />

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Card>
          <CardHeader title="What this screen will do" />
          <div className="flex gap-3 p-4">
            <Construction className="mt-0.5 size-5 shrink-0 text-warn" aria-hidden />
            <div className="flex flex-col gap-3">
              <p className="max-w-prose text-sm text-ink-soft">{item.description}</p>
              <p className="max-w-prose text-sm text-ink-faint">
                The route, the permission (<code className="font-mono text-xs">{item.permission}</code>)
                and the place in the menu are already fixed, so building it does not move anything
                else. Approvals will run on the shared engine that Leave and Attendance already use,
                and dates will use the same Bikram Sambat conversion.
              </p>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader
            title={`${mod.label} module`}
            description={mod.summary}
          />
          <ul className="divide-y divide-line-soft">
            {siblings?.sections.flatMap((s) => s.items).map((n) => (
              <li key={n.id}>
                <Link
                  href={n.href}
                  className="flex items-center justify-between gap-2 px-4 py-2 hover:bg-sunk"
                >
                  <span
                    className={
                      n.href === href
                        ? "text-sm font-medium text-ink"
                        : "text-sm text-ink-soft"
                    }
                  >
                    {n.label}
                  </span>
                  <Badge tone={n.status === "ready" ? "ok" : "neutral"}>
                    {n.status === "ready" ? "Live" : "Planned"}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
