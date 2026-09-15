"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Check, Eye, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { actAsRole, type ActState, type SwitchableRole } from "@/app/(app)/admin/act-as/actions";

const initial: ActState = {};

/**
 * "View as" — an icon button, not a form control.
 *
 * A `<select>` in a top bar reads as a setting you are expected to configure. It
 * is not one: it is a diagnostic somebody reaches for occasionally, so it earns
 * an icon and a menu, the way impersonation is presented in every admin console
 * that has one.
 *
 * The distinction this component exists to preserve: **viewing as a role never
 * changes what role you hold.** The account keeps its own identity throughout —
 * the header still says Administrator — and the assumed role is shown as a
 * temporary state layered on top of it, not as a replacement for it.
 */
export function RoleSwitcher({
  roles,
  actingAs,
}: {
  roles: SwitchableRole[];
  actingAs: { id: string; name: string } | null;
}) {
  const [state, action, pending] = useActionState(actAsRole, initial);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  // Close on an outside click or Escape. Both, because a menu that only closes
  // one way is a menu people end up clicking around.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (roles.length === 0) return null;

  const label = actingAs ? `Viewing as ${actingAs.name}` : "View as another role";

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={state.error ?? label}
        className={cn(
          "relative grid size-7 place-items-center rounded transition-colors",
          actingAs
            ? "bg-warn-soft text-warn hover:opacity-80"
            : "text-ink-faint hover:bg-sunk hover:text-ink",
        )}
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />}
        {/* A dot, not a label: the header has no room, and the amber ring plus
            the badge under the user's name already carry the state. */}
        {actingAs && !pending ? (
          <span
            className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-warn ring-2 ring-surface"
            aria-hidden
          />
        ) : null}
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1.5 w-60 overflow-hidden rounded-md border border-line bg-surface shadow-lg"
        >
          <div className="border-b border-line-soft px-3 py-2">
            <p className="text-xs font-medium text-ink">View as</p>
            <p className="mt-0.5 text-[11px] leading-snug text-ink-faint">
              See the product with another role&rsquo;s access. Your own role is unchanged.
            </p>
          </div>

          <form action={action} onSubmit={() => setOpen(false)} className="p-1">
            <MenuItem
              name="roleId"
              value=""
              label="Myself"
              hint="Administrator"
              selected={!actingAs}
            />
            <div className="my-1 h-px bg-line-soft" aria-hidden />
            {roles.map((r) => (
              <MenuItem
                key={r.id}
                name="roleId"
                value={r.id}
                label={r.name}
                hint={r.code}
                selected={actingAs?.id === r.id}
              />
            ))}
          </form>
        </div>
      ) : null}
    </div>
  );
}

/**
 * One choice, submitted as a button rather than a radio plus a submit.
 *
 * `<button name value>` puts the clicked value in the payload directly, so there
 * is no intermediate state that can be left stale between render and submit —
 * the bug that made an earlier version of the period-lock board write to the
 * wrong row.
 */
function MenuItem({
  name,
  value,
  label,
  hint,
  selected,
}: {
  name: string;
  value: string;
  label: string;
  hint?: string;
  selected: boolean;
}) {
  return (
    <button
      type="submit"
      name={name}
      value={value}
      role="menuitemradio"
      aria-checked={selected}
      className={cn(
        "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] transition-colors",
        selected ? "bg-accent-soft text-accent" : "text-ink-soft hover:bg-sunk hover:text-ink",
      )}
    >
      <Check className={cn("size-3.5 shrink-0", selected ? "opacity-100" : "opacity-0")} aria-hidden />
      <span className="flex-1 truncate">{label}</span>
      {hint ? <span className="font-mono text-[10px] text-ink-faint">{hint}</span> : null}
    </button>
  );
}
