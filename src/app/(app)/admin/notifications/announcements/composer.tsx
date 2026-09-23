"use client";

import { useActionState, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Send, Users } from "lucide-react";
import { Button, Card, CardHeader, Field, Input, Select, Textarea } from "@/components/ui";
import { cn } from "@/lib/utils";
import { audienceCountAction, sendAnnouncementAction, type AdminState } from "../actions";

type Option = { id: string; name: string };

const SEVERITIES = [
  { value: "info", label: "Information", dot: "bg-info" },
  { value: "success", label: "Good news", dot: "bg-ok" },
  { value: "warning", label: "Important", dot: "bg-warn" },
  { value: "danger", label: "Urgent", dot: "bg-danger" },
] as const;

const initial: AdminState = {};

export function AnnouncementComposer({
  departments,
  branches,
  roles,
  everyone,
}: {
  departments: Option[];
  branches: Option[];
  roles: Option[];
  everyone: number;
}) {
  const [kind, setKind] = useState<"everyone" | "department" | "branch" | "role">("everyone");
  const [target, setTarget] = useState("");
  // audience sizes as the server reports them, keyed "kind:id"
  const [sizes, setSizes] = useState<Record<string, number>>({});
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [severity, setSeverity] = useState<(typeof SEVERITIES)[number]["value"]>("info");
  const form = useRef<HTMLFormElement>(null);

  // a sent announcement clears the form for the next one — done in the action,
  // where the result is known, rather than in an effect watching for it
  const [state, action, pending] = useActionState(async (prev: AdminState, formData: FormData) => {
    const result = await sendAnnouncementAction(prev, formData);
    if (result.ok) {
      form.current?.reset();
      setTitle("");
      setBody("");
      setSeverity("info");
    }
    return result;
  }, initial);

  const options = kind === "department" ? departments : kind === "branch" ? branches : kind === "role" ? roles : [];
  const targetLabel = options.find((o) => o.id === target)?.name ?? "";

  const choose = (nextKind: typeof kind, nextTarget: string) => {
    setKind(nextKind);
    setTarget(nextTarget);
    const key = `${nextKind}:${nextTarget}`;
    if (nextKind !== "everyone" && nextTarget && sizes[key] === undefined) {
      void audienceCountAction(nextKind, nextTarget).then((n) => setSizes((s) => ({ ...s, [key]: n })));
    }
  };

  // null: nobody chosen yet; undefined: being counted
  const reach: number | null | undefined =
    kind === "everyone" ? everyone : target ? sizes[`${kind}:${target}`] : null;

  const err = (k: string) => state.fieldErrors?.[k];
  const dot = SEVERITIES.find((s) => s.value === severity)!.dot;

  return (
    <Card>
      <CardHeader
        title="New announcement"
        description="Appears in each recipient's bell and inbox straight away; email is optional."
      />
      <form ref={form} action={action} className="grid gap-4 p-4 lg:grid-cols-[1fr_18rem]">
        <div className="flex flex-col gap-4">
          {state.ok ? (
            <p className="flex items-center gap-1.5 rounded bg-ok-soft px-3 py-2 text-sm text-ok" role="status">
              <CheckCircle2 className="size-4" /> {state.ok}
            </p>
          ) : null}
          {state.error ? (
            <p className="flex items-center gap-1.5 rounded bg-danger-soft px-3 py-2 text-sm text-danger">
              <AlertCircle className="size-4" /> {state.error}
            </p>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Send to" required>
              <Select
                name="audienceKind"
                value={kind}
                onChange={(e) => choose(e.target.value as typeof kind, "")}
              >
                <option value="everyone">Everyone</option>
                <option value="department">A department</option>
                <option value="branch">A branch</option>
                <option value="role">A role</option>
              </Select>
            </Field>
            {kind !== "everyone" ? (
              <Field label={kind === "department" ? "Department" : kind === "branch" ? "Branch" : "Role"} required error={err("audienceId")}>
                <Select name="audienceId" value={target} onChange={(e) => choose(kind, e.target.value)}>
                  <option value="">Select…</option>
                  {options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            <input type="hidden" name="audienceLabel" value={targetLabel} />
          </div>

          <Field label="Title" required error={err("title")}>
            <Input name="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} placeholder="Office closed on Friday for Dashain" />
          </Field>
          <Field label="Message" error={err("body")} hint="Plain text. Line breaks are kept.">
            <Textarea name="body" value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={2000} />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Link" error={err("href")} hint="Optional in-app page, e.g. /me/notices or /leave/my.">
              <Input name="href" placeholder="/me/notices" maxLength={200} />
            </Field>
            <fieldset>
              <legend className="mb-1 text-xs font-medium text-ink-soft">Importance</legend>
              <div className="flex flex-wrap gap-1.5">
                {SEVERITIES.map((s) => (
                  <label
                    key={s.value}
                    className={cn(
                      "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
                      severity === s.value ? "border-accent bg-accent-soft text-accent" : "border-line text-ink-soft hover:bg-sunk",
                    )}
                  >
                    <input
                      type="radio"
                      name="severity"
                      value={s.value}
                      checked={severity === s.value}
                      onChange={() => setSeverity(s.value)}
                      className="sr-only"
                    />
                    <span className={cn("size-2 rounded-full", s.dot)} aria-hidden />
                    {s.label}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="email" className="mt-0.5 size-4 accent-[var(--color-accent)]" />
            <span>
              Also send by email
              <span className="block text-xs text-ink-faint">Respects each person&rsquo;s email preference for announcements.</span>
            </span>
          </label>
        </div>

        <aside className="flex flex-col gap-3">
          <div className="rounded-md border border-line bg-ground p-3">
            <p className="mb-2 text-[11px] font-medium tracking-wide text-ink-faint uppercase">Preview</p>
            <div className="flex items-start gap-2.5 rounded bg-surface p-2.5 shadow-sm">
              <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", dot)} aria-hidden />
              <div className="min-w-0">
                <p className="text-sm font-medium break-words text-ink">{title || "Your title"}</p>
                {body ? <p className="mt-0.5 text-xs break-words whitespace-pre-line text-ink-soft">{body}</p> : null}
                <p className="mt-1 text-[11px] text-ink-faint">just now</p>
              </div>
            </div>
          </div>
          <p className="flex items-center gap-2 rounded border border-line px-3 py-2 text-sm">
            <Users className="size-4 text-ink-faint" />
            {reach === null ? (
              <span className="text-ink-faint">Choose who it is for</span>
            ) : reach === undefined ? (
              <span className="text-ink-faint">Counting…</span>
            ) : (
              <span>
                Will reach <span className="tabular font-semibold text-ink">{reach}</span> {reach === 1 ? "person" : "people"}
              </span>
            )}
          </p>
          <Button type="submit" disabled={pending || !title.trim() || !reach}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            Send announcement
          </Button>
        </aside>
      </form>
    </Card>
  );
}
