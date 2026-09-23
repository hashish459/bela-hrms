"use client";

import { useActionState, useMemo, useState } from "react";
import { Copy, Pencil, Plus, Power, Search, Trash2 } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { useConfirmSubmit, useToastedAction } from "@/components/feedback";
import { cn } from "@/lib/utils";
import { leaveTypeCommandAction, type AdminState } from "../admin-actions";
import { NEW_TYPE, TypeEditor, type TypeValues } from "./type-editor";

export type TypeCard = {
  id: string;
  code: string;
  name: string;
  nameNepali: string | null;
  colour: string;
  isActive: boolean;
  group: string | null;
  groupId: string | null;
  summary: { daysPerYear: string; paid: string; lapse: string; approvals: string; eligibility: string | null };
  flags: string[];
  usage: { requests: number; open: number; holders: number };
  values: TypeValues;
};

const initial: AdminState = {};

function Command({ id, op, label, icon: Icon, confirm, disabled, title, tone }: {
  id: string;
  op: "activate" | "deactivate" | "delete" | "duplicate";
  label: string;
  icon: typeof Pencil;
  confirm?: Parameters<typeof useConfirmSubmit>[0];
  disabled?: boolean;
  title?: string;
  tone?: "danger";
}) {
  const [, action, pending] = useActionState(useToastedAction(leaveTypeCommandAction, { errors: true }), initial);
  const ask = useConfirmSubmit(confirm ?? (() => null));
  return (
    <form action={action} onSubmit={ask}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="op" value={op} />
      <button
        type="submit"
        disabled={pending || disabled}
        title={title ?? label}
        aria-label={label}
        className={cn(
          "grid size-8 place-items-center rounded-md text-ink-faint transition-colors disabled:cursor-not-allowed disabled:opacity-30",
          tone === "danger" ? "hover:bg-danger-soft hover:text-danger" : "hover:bg-sunk hover:text-ink",
        )}
      >
        <Icon className="size-4" />
      </button>
    </form>
  );
}

/** The leave type catalogue: find, filter, and every action on a type. */
export function TypesBoard({ cards, groups, editId }: { cards: TypeCard[]; groups: { id: string; name: string }[]; editId?: string | null }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "inactive">("all");
  const [group, setGroup] = useState("");
  // arriving with ?edit=<id> (from the policy screen) opens that type straight away
  const [editing, setEditing] = useState<{ id: string | null; values: TypeValues } | null>(() => {
    const c = editId ? cards.find((x) => x.id === editId) : undefined;
    return c ? { id: c.id, values: c.values } : null;
  });

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return cards.filter(
      (c) =>
        (status === "all" || (status === "active") === c.isActive) &&
        (!group || c.groupId === group) &&
        (!needle || `${c.name} ${c.code} ${c.nameNepali ?? ""}`.toLowerCase().includes(needle)),
    );
  }, [cards, q, status, group]);

  const counts = { all: cards.length, active: cards.filter((c) => c.isActive).length, inactive: cards.filter((c) => !c.isActive).length };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-faint" aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find a leave type by name or code"
            aria-label="Find a leave type"
            className="w-full rounded-md border border-line bg-surface py-2 pr-3 pl-8 text-sm text-ink placeholder:text-ink-faint"
          />
        </label>
        <div className="flex rounded-md border border-line bg-surface p-0.5" role="tablist" aria-label="Status">
          {(["all", "active", "inactive"] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={status === s}
              onClick={() => setStatus(s)}
              className={cn("rounded px-3 py-1.5 text-xs capitalize transition-colors", status === s ? "bg-accent text-on-accent" : "text-ink-soft hover:bg-sunk")}
            >
              {s} <span className="tabular opacity-70">{counts[s]}</span>
            </button>
          ))}
        </div>
        {groups.length ? (
          <select value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Group" className="rounded-md border border-line bg-surface px-2.5 py-2 text-sm text-ink">
            <option value="">All groups</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        ) : null}
        <Button type="button" onClick={() => setEditing({ id: null, values: NEW_TYPE })}>
          <Plus className="size-4" />
          New leave type
        </Button>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-md border border-dashed border-line bg-surface px-4 py-12 text-center text-sm text-ink-faint">
          {cards.length ? "No leave type matches." : "No leave types yet — create the first one."}
        </div>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {shown.map((c) => {
            const used = c.usage.requests > 0 || c.usage.holders > 0;
            return (
              <li
                key={c.id}
                className={cn("group relative flex flex-col overflow-hidden rounded-lg border border-line bg-surface transition-shadow hover:shadow-md", !c.isActive && "opacity-70")}
              >
                <span className="absolute inset-y-0 left-0 w-1" style={{ background: c.colour }} aria-hidden />
                <div className="flex items-start gap-3 px-4 pt-3.5 pb-2 pl-5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" onClick={() => setEditing({ id: c.id, values: c.values })} className="truncate text-left text-base font-semibold text-ink hover:text-accent">
                        {c.name}
                      </button>
                      <span className="rounded bg-sunk px-1.5 py-0.5 font-mono text-[10px] text-ink-soft">{c.code}</span>
                      {c.isActive ? <Badge tone="ok">Active</Badge> : <Badge tone="neutral">Inactive</Badge>}
                      {c.group ? <Badge tone="info">{c.group}</Badge> : null}
                    </div>
                    {c.nameNepali ? <p className="text-xs text-ink-faint">{c.nameNepali}</p> : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5 opacity-70 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => setEditing({ id: c.id, values: c.values })}
                      className="grid size-8 place-items-center rounded-md text-ink-faint hover:bg-sunk hover:text-ink"
                      aria-label={`Edit ${c.name}`}
                      title="Edit"
                    >
                      <Pencil className="size-4" />
                    </button>
                    <Command id={c.id} op="duplicate" label={`Duplicate ${c.name}`} title="Duplicate" icon={Copy} />
                    {c.isActive ? (
                      <Command
                        id={c.id}
                        op="deactivate"
                        label={`Deactivate ${c.name}`}
                        title={c.usage.open ? "Decide its open requests first" : "Deactivate"}
                        icon={Power}
                        disabled={c.usage.open > 0}
                        confirm={{ title: `Deactivate ${c.name}?`, body: "Nobody can apply for it any more. Existing balances, requests and history stay exactly as they are, and it can be switched back on.", confirmLabel: "Deactivate", tone: "warning" }}
                      />
                    ) : (
                      <Command id={c.id} op="activate" label={`Activate ${c.name}`} title="Activate" icon={Power} />
                    )}
                    <Command
                      id={c.id}
                      op="delete"
                      label={`Delete ${c.name}`}
                      title={used ? "Used in requests or balances — deactivate instead" : "Delete"}
                      icon={Trash2}
                      tone="danger"
                      disabled={used}
                      confirm={{ title: `Delete ${c.name}?`, body: "It has never been used, so it is removed completely along with its empty balances and entitlements. This cannot be undone.", confirmLabel: "Delete leave type", tone: "danger" }}
                    />
                  </div>
                </div>

                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 px-5 pb-3 text-xs sm:grid-cols-4">
                  {(
                    [
                      ["Per year", c.summary.daysPerYear],
                      ["Pay", c.summary.paid],
                      ["Unused days", c.summary.lapse],
                      ["Approval", c.summary.approvals],
                    ] as const
                  ).map(([k, v]) => (
                    <div key={k} className="min-w-0">
                      <dt className="text-[10px] tracking-wide text-ink-faint uppercase">{k}</dt>
                      <dd className="truncate font-medium text-ink" title={v}>
                        {v}
                      </dd>
                    </div>
                  ))}
                </dl>

                <div className="mt-auto flex flex-wrap items-center gap-1.5 border-t border-line-soft bg-sunk/30 px-5 py-2 text-[11px]">
                  {c.summary.eligibility ? <span className="rounded-full bg-info-soft px-2 py-0.5 text-info">{c.summary.eligibility}</span> : null}
                  {c.flags.map((f) => (
                    <span key={f} className="rounded-full border border-line bg-surface px-2 py-0.5 text-ink-soft">
                      {f}
                    </span>
                  ))}
                  <span className="ml-auto text-ink-faint">
                    {c.usage.requests} request{c.usage.requests === 1 ? "" : "s"}
                    {c.usage.open ? <span className="text-warn"> · {c.usage.open} open</span> : null}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {editing ? <TypeEditor key={editing.id ?? "new"} id={editing.id} values={editing.values} groups={groups} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}
