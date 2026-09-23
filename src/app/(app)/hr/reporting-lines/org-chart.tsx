"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Loader2, Pencil, Search, X } from "lucide-react";
import { Badge, Button, EmptyState, Select } from "@/components/ui";
import { Avatar } from "@/components/avatar";
import { setSupervisor } from "./actions";

/**
 * The reporting chart, editable in place.
 *
 * The whole list is sent once and the tree is built here rather than on the
 * server, which buys two things that matter more than the payload: searching
 * and expanding are instant, and reassigning somebody can validate against the
 * live shape of the tree before it asks the server to do anything.
 *
 * The one rule this component enforces on its own is that a person may not be
 * moved under their own descendant. The server checks the same thing — it has
 * to, because nothing stops a request arriving without this page — but doing it
 * here as well means the impossible choice is never offered in the first place,
 * which is a better experience than an error after the fact.
 */

export type ChartPerson = {
  id: string;
  code: string;
  name: string;
  photoFileId: string | null;
  designation: string | null;
  department: string | null;
  supervisorId: string | null;
  status: string;
};

type Node = ChartPerson & { children: Node[]; depth: number };

function buildForest(people: ChartPerson[]) {
  const byId = new Map<string, Node>();
  for (const p of people) byId.set(p.id, { ...p, children: [], depth: 0 });

  const roots: Node[] = [];
  /**
   * People caught in a reporting loop.
   *
   * The edit path prevents new ones, but imported data can arrive with one, and
   * the previous version of this page dropped those people from the chart
   * entirely — they were not roots and their parent was unreachable, so they
   * simply vanished. Surfacing them is the whole point: an invisible loop is
   * one nobody fixes.
   */
  const looped: Node[] = [];

  const rootOf = (node: Node) => {
    const seen = new Set<string>([node.id]);
    let cursor = node.supervisorId;
    while (cursor) {
      if (seen.has(cursor)) return null; // cycle
      seen.add(cursor);
      cursor = byId.get(cursor)?.supervisorId ?? null;
    }
    return true;
  };

  for (const node of byId.values()) {
    const parent = node.supervisorId ? byId.get(node.supervisorId) : undefined;
    if (!parent || parent.id === node.id) {
      roots.push(node);
      continue;
    }
    if (rootOf(node) === null) {
      looped.push(node);
      continue;
    }
    parent.children.push(node);
  }

  const sortTree = (nodes: Node[], depth: number) => {
    nodes.sort((a, b) => a.code.localeCompare(b.code));
    for (const n of nodes) {
      n.depth = depth;
      sortTree(n.children, depth + 1);
    }
  };
  sortTree(roots, 0);

  return { roots, looped, byId };
}

/** Everyone at or below `id`, so they can be excluded from its supervisor list. */
function descendantsOf(node: Node, into = new Set<string>()) {
  into.add(node.id);
  for (const c of node.children) descendantsOf(c, into);
  return into;
}

function flatten(nodes: Node[], out: Node[] = []) {
  for (const n of nodes) {
    out.push(n);
    flatten(n.children, out);
  }
  return out;
}

export function OrgChart({
  people,
  canEdit,
}: {
  people: ChartPerson[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const [, startTransition] = useTransition();

  const { roots, looped, byId } = useMemo(() => buildForest(people), [people]);

  /** Matching nodes, plus every ancestor, so a match is never orphaned. */
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;

    const keep = new Set<string>();
    for (const p of people) {
      const hit =
        p.name.toLowerCase().includes(q) ||
        p.code.toLowerCase().includes(q) ||
        (p.designation ?? "").toLowerCase().includes(q) ||
        (p.department ?? "").toLowerCase().includes(q);
      if (!hit) continue;

      keep.add(p.id);
      let cursor = p.supervisorId;
      const guard = new Set<string>();
      while (cursor && !guard.has(cursor)) {
        guard.add(cursor);
        keep.add(cursor);
        cursor = byId.get(cursor)?.supervisorId ?? null;
      }
    }
    return keep;
  }, [query, people, byId]);

  const options = useMemo(
    () => [...byId.values()].sort((a, b) => a.code.localeCompare(b.code)),
    [byId],
  );

  function assign(node: Node, supervisorId: string | null) {
    setBusyId(node.id);
    setMessage(null);
    startTransition(async () => {
      const result = await setSupervisor(node.id, supervisorId);
      setBusyId(null);
      setMessage({
        tone: result.ok ? "ok" : "danger",
        text: result.message ?? (result.ok ? "Saved." : "That did not work."),
      });
      if (result.ok) router.refresh();
    });
  }

  function toggle(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allNodes = flatten(roots);
  const widest = allNodes.reduce((m, n) => Math.max(m, n.children.length), 0);
  const deepest = allNodes.reduce((m, n) => Math.max(m, n.depth + 1), 0);

  function renderNode(node: Node): React.ReactNode {
    if (visible && !visible.has(node.id)) return null;

    const isCollapsed = collapsed.has(node.id) && !visible;
    const blocked = descendantsOf(node);

    return (
      <li key={node.id}>
        <div
          className="group flex flex-wrap items-center gap-2 rounded px-2 py-1.5 hover:bg-sunk"
          style={{ marginLeft: `${node.depth * 1.5}rem` }}
        >
          {node.children.length > 0 ? (
            <button
              type="button"
              onClick={() => toggle(node.id)}
              className="rounded p-0.5 text-ink-faint hover:text-ink"
              aria-expanded={!isCollapsed}
            >
              {isCollapsed ? (
                <ChevronRight className="size-3.5" />
              ) : (
                <ChevronDown className="size-3.5" />
              )}
              <span className="sr-only">
                {isCollapsed ? "Expand" : "Collapse"} {node.name}
              </span>
            </button>
          ) : (
            <span className="inline-block size-4 shrink-0" aria-hidden />
          )}

          <Avatar
            photoId={node.photoFileId}
            firstName={node.name.split(" ")[0] ?? "?"}
            lastName={node.name.split(" ").slice(-1)[0] ?? ""}
            seed={node.id}
            size="xs"
          />

          <Link
            href={`/hr/employees/${node.id}`}
            className="text-sm font-medium text-ink hover:text-accent"
          >
            {node.name}
          </Link>
          <span className="font-mono text-[11px] text-ink-faint">{node.code}</span>
          {node.designation ? (
            <span className="text-xs text-ink-soft">{node.designation}</span>
          ) : null}
          {node.department ? (
            <span className="text-xs text-ink-faint">· {node.department}</span>
          ) : null}
          {node.children.length > 0 ? (
            <Badge tone="neutral">
              {node.children.length} report{node.children.length === 1 ? "" : "s"}
            </Badge>
          ) : null}

          {editing && canEdit ? (
            <span className="ml-auto flex items-center gap-1.5">
              {busyId === node.id ? (
                <Loader2 className="size-3.5 animate-spin text-ink-faint" />
              ) : null}
              <Select
                aria-label={`Supervisor for ${node.name}`}
                value={node.supervisorId ?? ""}
                disabled={busyId !== null}
                onChange={(e) => assign(node, e.target.value || null)}
                className="w-60 py-1 text-xs"
              >
                <option value="">— No supervisor —</option>
                {options.map((o) =>
                  // Themselves, and anybody already under them: choosing either
                  // would close a loop.
                  blocked.has(o.id) ? null : (
                    <option key={o.id} value={o.id}>
                      {o.code} — {o.name}
                    </option>
                  ),
                )}
              </Select>
            </span>
          ) : null}
        </div>

        {node.children.length > 0 && !isCollapsed ? (
          <ul className="flex flex-col gap-0.5">{node.children.map(renderNode)}</ul>
        ) : null}
      </li>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-4 py-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-ink-faint" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a person, role or department"
            className="w-72 rounded border border-line bg-surface py-1.5 pr-2.5 pl-7 text-sm text-ink placeholder:text-ink-faint"
          />
        </div>

        <button
          type="button"
          onClick={() => setCollapsed(new Set())}
          className="rounded px-2 py-1.5 text-xs text-ink-faint hover:bg-sunk hover:text-ink"
        >
          Expand all
        </button>
        <button
          type="button"
          onClick={() => setCollapsed(new Set(allNodes.filter((n) => n.children.length).map((n) => n.id)))}
          className="rounded px-2 py-1.5 text-xs text-ink-faint hover:bg-sunk hover:text-ink"
        >
          Collapse all
        </button>

        <span className="ml-auto flex items-center gap-3 text-[11px] text-ink-faint">
          <span>{allNodes.length} charted</span>
          <span>{deepest} levels deep</span>
          <span>widest span {widest}</span>
        </span>

        {canEdit ? (
          <Button variant={editing ? "primary" : "secondary"} onClick={() => setEditing(!editing)}>
            {editing ? <X className="size-4" /> : <Pencil className="size-4" />}
            {editing ? "Done" : "Edit reporting lines"}
          </Button>
        ) : null}
      </div>

      {message ? (
        <p
          className={
            message.tone === "ok"
              ? "border-b border-line-soft bg-ok-soft px-4 py-2 text-sm text-ok"
              : "border-b border-line-soft bg-danger-soft px-4 py-2 text-sm text-danger"
          }
        >
          {message.text}
        </p>
      ) : null}

      {editing ? (
        <p className="border-b border-line-soft bg-accent-soft px-4 py-2 text-xs text-accent">
          Changing a supervisor also changes who approves that person&rsquo;s leave — level one is
          the direct supervisor, level two theirs. Anyone already below a person is left out of
          their own list, because moving them there would make a loop.
        </p>
      ) : null}

      {roots.length === 0 ? (
        <EmptyState title="No employees to chart" />
      ) : (
        <div className="overflow-x-auto p-4">
          <ul className="flex flex-col gap-0.5">{roots.map(renderNode)}</ul>
          {visible && visible.size === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-ink-faint">
              Nobody matches &ldquo;{query}&rdquo;.
            </p>
          ) : null}
        </div>
      )}

      {looped.length > 0 ? (
        <div className="border-t border-line-soft bg-danger-soft/40 px-4 py-3">
          <p className="text-sm font-medium text-danger">Reporting loop</p>
          <p className="mt-0.5 text-xs text-ink-soft">
            These people report to somebody who reports back to them, so they cannot appear in the
            chart and their leave cannot be routed. Give each one a supervisor outside the loop.
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {looped.map((n) => (
              <li key={n.id}>
                <Link href={`/hr/employees/${n.id}`}>
                  <Badge tone="danger">
                    {n.name} · {n.code}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
