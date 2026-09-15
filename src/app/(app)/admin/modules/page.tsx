import { AlertTriangle, CheckCircle2, CircleSlash, XCircle } from "lucide-react";
import { requirePermission } from "@/lib/session";
import { Badge, Card, CardHeader, PageHeader, StatTile, TableShell, Td, Th, Tr } from "@/components/ui";
import { health, type ModuleState } from "@/kernel/registry";
import { queueDepth } from "@/kernel/events";
import { loadModuleStates, moduleStateRows } from "@/kernel/boot";
import { ModuleSwitch, ReplayDeadButton } from "./forms";

export const metadata = { title: "Modules" };

const TONE: Record<ModuleState, { tone: "ok" | "warn" | "danger" | "neutral"; label: string }> = {
  ready: { tone: "ok", label: "Running" },
  degraded: { tone: "warn", label: "Degraded" },
  failed: { tone: "danger", label: "Failed" },
  not_installed: { tone: "neutral", label: "Switched off" },
};

const ICON: Record<ModuleState, typeof CheckCircle2> = {
  ready: CheckCircle2,
  degraded: AlertTriangle,
  failed: XCircle,
  not_installed: CircleSlash,
};

export default async function ModulesPage() {
  const viewer = await requirePermission("admin.settings.manage");

  await loadModuleStates(viewer.orgId);
  const [modules, queue, switches] = await Promise.all([
    Promise.resolve(health(viewer.orgId)),
    queueDepth(viewer.orgId),
    moduleStateRows(viewer.orgId),
  ]);

  const switchedOff = new Set(switches.filter((s) => !s.isEnabled).map((s) => s.moduleId));
  const running = modules.filter((m) => m.state === "ready").length;
  const unhealthy = modules.filter((m) => m.state === "degraded" || m.state === "failed").length;

  return (
    <>
      <PageHeader
        title="Modules"
        description="What is installed, what it depends on, and what is currently working."
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Running" value={running} tone="ok" />
        <StatTile
          label="Degraded or failed"
          value={unhealthy}
          tone={unhealthy > 0 ? "warn" : "neutral"}
        />
        <StatTile
          label="Events waiting"
          value={queue.pending}
          sub={queue.oldestPendingAt ? `oldest ${queue.oldestPendingAt.toLocaleString("en-GB")}` : "queue empty"}
          tone={queue.pending > 20 ? "warn" : "neutral"}
        />
        <StatTile
          label="Parked events"
          value={queue.dead}
          sub={queue.dead > 0 ? "gave up after 5 attempts" : "none"}
          tone={queue.dead > 0 ? "danger" : "neutral"}
        />
      </div>

      <Card className="mb-5">
        <CardHeader
          title="Installed modules"
          description="A module that fails is contained: the others keep running, and anything that needed it degrades rather than breaking."
          action={queue.dead > 0 ? <ReplayDeadButton /> : undefined}
        />
        <TableShell>
          <thead>
            <tr>
              <Th>Module</Th>
              <Th>State</Th>
              <Th>Depends on</Th>
              <Th>Detail</Th>
              <Th className="text-right">Enabled</Th>
            </tr>
          </thead>
          <tbody>
            {modules.map((m) => {
              const tone = TONE[m.state];
              const Icon = ICON[m.state];
              return (
                <Tr key={m.id}>
                  <Td>
                    <span className="flex items-center gap-2">
                      <Icon
                        className={`size-4 ${
                          m.state === "ready"
                            ? "text-ok"
                            : m.state === "degraded"
                              ? "text-warn"
                              : m.state === "failed"
                                ? "text-danger"
                                : "text-ink-faint"
                        }`}
                        aria-hidden
                      />
                      <span className="font-medium text-ink">{m.id}</span>
                      <span className="font-mono text-[11px] text-ink-faint">{m.version}</span>
                    </span>
                  </Td>
                  <Td>
                    <Badge tone={tone.tone}>{tone.label}</Badge>
                  </Td>
                  <Td>
                    <span className="flex flex-wrap gap-1">
                      {m.requires.map((d) => (
                        <Badge key={d} tone="danger">
                          {d}
                        </Badge>
                      ))}
                      {m.optional.map((d) => (
                        <Badge key={d} tone="neutral">
                          {d}
                        </Badge>
                      ))}
                      {m.requires.length + m.optional.length === 0 ? (
                        <span className="text-xs text-ink-faint">nothing</span>
                      ) : null}
                    </span>
                  </Td>
                  <Td>
                    <span className="text-xs text-ink-soft">{m.detail}</span>
                  </Td>
                  <Td className="text-right">
                    <ModuleSwitch moduleId={m.id} enabled={!switchedOff.has(m.id)} />
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </TableShell>
      </Card>

      <Card>
        <CardHeader
          title="How to read this"
          description="Dependency colours: red is required, grey is optional."
        />
        <div className="flex max-w-[70ch] flex-col gap-2 p-4 text-sm text-ink-soft">
          <p>
            <strong className="text-ink">Degraded</strong> means the module is running without
            something it would normally use — leave without attendance, say. Work still commits; the
            part that needed the missing module is queued or skipped, and this page says which.
          </p>
          <p>
            <strong className="text-ink">Events waiting</strong> is the outbox. A module publishes an
            event inside its own transaction and the others react afterwards, so a fault downstream
            delays a reaction instead of rolling back the work that caused it. A number that keeps
            climbing means a subscriber is failing — the parked count and the module detail say
            which one.
          </p>
          <p>
            Switching a module off hides it from this organisation entirely: its screens leave the
            menu, its ports stop resolving, and callers fall back. It is the safe way to take one
            module out of service without a deployment.
          </p>
        </div>
      </Card>
    </>
  );
}
