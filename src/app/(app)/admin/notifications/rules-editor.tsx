"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { AlertCircle, CheckCircle2, FlaskConical, Loader2, Mail, MonitorSmartphone, Pencil, RotateCcw, X } from "lucide-react";
import { Badge, Button, Field, Input, Textarea } from "@/components/ui";
import { cn } from "@/lib/utils";
import { RECIPIENT_LABEL, render, type Recipient } from "@/modules/notifications/catalogue";
import { resetRuleAction, saveRuleAction, testRuleAction, toggleRuleAction, type AdminState } from "./actions";

export type RuleView = {
  key: string;
  label: string;
  description: string;
  category: string;
  categoryLabel: string;
  severity: string;
  enabled: boolean;
  inApp: boolean;
  email: boolean;
  recipients: Recipient[];
  allowedRecipients: Recipient[];
  hrPermission: string | null;
  title: string;
  body: string;
  placeholders: Record<string, string>;
  threshold: { value: number | null; label: string } | null;
  isCustomised: boolean;
  sentLast30: number;
};

const initial: AdminState = {};

/** A switch that looks like one, and is a real checkbox underneath. */
function Switch({
  checked,
  defaultChecked,
  onChange,
  label,
  disabled,
  name,
}: {
  /** Controlled; or leave it out and pass defaultChecked for a plain form field. */
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (v: boolean) => void;
  label: string;
  disabled?: boolean;
  name?: string;
}) {
  return (
    <label className={cn("relative inline-flex cursor-pointer items-center", disabled && "cursor-not-allowed opacity-50")}>
      <input
        type="checkbox"
        name={name}
        checked={checked}
        defaultChecked={checked === undefined ? defaultChecked : undefined}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
        className="peer sr-only"
        aria-label={label}
      />
      <span className="h-5 w-9 rounded-full bg-line transition-colors peer-checked:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent" />
      <span className="absolute left-0.5 size-4 rounded-full bg-surface shadow transition-transform peer-checked:translate-x-4" />
    </label>
  );
}

export function RulesEditor({ rules }: { rules: RuleView[] }) {
  const [editing, setEditing] = useState<RuleView | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [local, setLocal] = useState<Record<string, boolean>>({});
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(t);
  }, [toast]);

  const groups = [...new Set(rules.map((r) => r.categoryLabel))];

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <section key={group} className="overflow-hidden rounded-md border border-line bg-surface">
          <h3 className="border-b border-line bg-sunk px-4 py-2 text-[11px] font-medium tracking-wide text-ink-faint uppercase">{group}</h3>
          <ul className="divide-y divide-line-soft">
            {rules
              .filter((r) => r.categoryLabel === group)
              .map((r) => {
                const enabled = local[r.key] ?? r.enabled;
                return (
                  <li key={r.key} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                    <Switch
                      checked={enabled}
                      label={`${r.label} ${enabled ? "on" : "off"}`}
                      onChange={(v) => {
                        setLocal((l) => ({ ...l, [r.key]: v }));
                        startTransition(async () => {
                          const res = await toggleRuleAction(r.key, v);
                          setToast(res.ok ? `${r.label}: ${res.ok.toLowerCase()}` : (res.error ?? null));
                        });
                      }}
                    />
                    <div className="min-w-60 flex-1">
                      <p className={cn("text-sm font-medium", enabled ? "text-ink" : "text-ink-faint")}>
                        {r.label}
                        {r.isCustomised ? <Badge className="ml-2" tone="info">Customised</Badge> : null}
                      </p>
                      <p className="text-xs text-ink-faint">{r.description}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span
                        className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5", r.inApp ? "bg-accent-soft text-accent" : "bg-sunk text-ink-faint line-through")}
                        title="In-app"
                      >
                        <MonitorSmartphone className="size-3" /> In app
                      </span>
                      <span
                        className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5", r.email ? "bg-info-soft text-info" : "bg-sunk text-ink-faint line-through")}
                        title="Email"
                      >
                        <Mail className="size-3" /> Email
                      </span>
                    </div>
                    <p className="w-52 truncate text-xs text-ink-soft" title={r.recipients.map((x) => RECIPIENT_LABEL[x]).join(", ")}>
                      {r.recipients.length ? r.recipients.map((x) => RECIPIENT_LABEL[x].split(" (")[0]).join(" · ") : "—"}
                    </p>
                    <p className="tabular w-16 text-right text-xs text-ink-faint" title="Delivered in the last 30 days">
                      {r.sentLast30} sent
                    </p>
                    <Button type="button" variant="secondary" className="px-2 py-1 text-xs" onClick={() => setEditing(r)}>
                      <Pencil className="size-3.5" /> Edit
                    </Button>
                  </li>
                );
              })}
          </ul>
        </section>
      ))}

      {editing ? (
        <RuleDrawer
          key={editing.key}
          rule={{ ...editing, enabled: local[editing.key] ?? editing.enabled }}
          onClose={() => setEditing(null)}
          onDone={(m) => {
            setToast(m);
            // the server's value is authoritative again once the drawer has written
            setLocal((l) => {
              const next = { ...l };
              delete next[editing.key];
              return next;
            });
          }}
        />
      ) : null}

      {toast ? (
        <div role="status" className="fixed right-4 bottom-4 z-[60] flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-sm shadow-lg">
          <CheckCircle2 className="size-4 text-ok" /> {toast}
        </div>
      ) : null}
    </div>
  );
}

function RuleDrawer({ rule, onClose, onDone }: { rule: RuleView; onClose: () => void; onDone: (m: string) => void }) {
  const [saveState, save, saving] = useActionState(saveRuleAction, initial);
  const [testState, test, testing] = useActionState(testRuleAction, initial);
  const [resetState, reset, resetting] = useActionState(resetRuleAction, initial);
  const [title, setTitle] = useState(rule.title);
  const [body, setBody] = useState(rule.body);
  const [email, setEmail] = useState(rule.email);
  const focused = useRef<"title" | "body">("title");
  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (saveState.at && saveState.ok) {
      onDone(`${rule.label}: saved`);
      onClose();
    }
  }, [saveState.at, saveState.ok, onDone, onClose, rule.label]);
  useEffect(() => {
    if (resetState.at && resetState.ok) {
      onDone(`${rule.label}: back to default`);
      onClose();
    }
  }, [resetState.at, resetState.ok, onDone, onClose, rule.label]);
  useEffect(() => {
    if (testState.at && testState.ok) onDone(testState.ok);
  }, [testState.at, testState.ok, onDone]);

  /** Inserts a placeholder where the cursor is in whichever template was last focused. */
  const insert = (key: string) => {
    const token = `{{${key}}}`;
    const el = focused.current === "title" ? titleRef.current : bodyRef.current;
    const setter = focused.current === "title" ? setTitle : setBody;
    const value = focused.current === "title" ? title : body;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    setter(value.slice(0, start) + token + value.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const errors = { ...saveState.fieldErrors, ...testState.fieldErrors };
  const error = saveState.error ?? testState.error ?? resetState.error;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`Edit ${rule.label}`}>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-ink/30" />
      <form action={save} className="absolute inset-y-0 right-0 flex w-full max-w-xl flex-col border-l border-line bg-surface shadow-2xl">
        <input type="hidden" name="key" value={rule.key} />
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <p className="text-[11px] tracking-wide text-ink-faint uppercase">{rule.categoryLabel}</p>
            <h2 className="text-base font-semibold text-ink">{rule.label}</h2>
            <p className="mt-0.5 text-xs text-ink-soft">{rule.description}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-ink-faint hover:bg-sunk hover:text-ink" aria-label="Close">
            <X className="size-4" />
          </button>
        </header>

        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
          {error ? (
            <p className="flex items-center gap-1.5 rounded bg-danger-soft px-3 py-2 text-sm text-danger">
              <AlertCircle className="size-4" /> {error}
            </p>
          ) : null}

          <fieldset className="grid gap-3 sm:grid-cols-3">
            <legend className="mb-2 text-xs font-medium text-ink-soft">Delivery</legend>
            <label className="flex items-center justify-between gap-2 rounded border border-line px-3 py-2 text-sm">
              Enabled
              <Switch name="isEnabled" defaultChecked={rule.enabled} label="Enabled" />
            </label>
            <label className="flex items-center justify-between gap-2 rounded border border-line px-3 py-2 text-sm">
              <span className="inline-flex items-center gap-1.5">
                <MonitorSmartphone className="size-3.5 text-ink-faint" /> In app
              </span>
              <input type="checkbox" name="inApp" defaultChecked={rule.inApp} className="size-4 accent-[var(--color-accent)]" />
            </label>
            <label className="flex items-center justify-between gap-2 rounded border border-line px-3 py-2 text-sm">
              <span className="inline-flex items-center gap-1.5">
                <Mail className="size-3.5 text-ink-faint" /> Email
              </span>
              <input
                type="checkbox"
                name="email"
                checked={email}
                onChange={(e) => setEmail(e.target.checked)}
                className="size-4 accent-[var(--color-accent)]"
              />
            </label>
            {errors.inApp ? <p className="text-xs text-danger sm:col-span-3">{errors.inApp}</p> : null}
          </fieldset>

          {rule.allowedRecipients.length ? (
            <fieldset>
              <legend className="mb-2 text-xs font-medium text-ink-soft">Who is told</legend>
              <div className="flex flex-col gap-1.5">
                {rule.allowedRecipients.map((r) => (
                  <label key={r} className="flex items-start gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      name="recipients"
                      value={r}
                      defaultChecked={rule.recipients.includes(r)}
                      className="mt-0.5 size-4 accent-[var(--color-accent)]"
                    />
                    <span>
                      {RECIPIENT_LABEL[r]}
                      {r === "hr" && rule.hrPermission ? (
                        <span className="ml-1 font-mono text-[11px] text-ink-faint">{rule.hrPermission}</span>
                      ) : null}
                    </span>
                  </label>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-ink-faint">Whoever caused the event is never notified about their own action.</p>
              {errors.recipients ? <p className="mt-1 text-xs text-danger">{errors.recipients}</p> : null}
            </fieldset>
          ) : null}

          {rule.threshold ? (
            <Field label={rule.threshold.label} error={errors.thresholdDays} hint="Reminders are checked every half hour and never sent twice for the same thing.">
              <Input type="number" name="thresholdDays" min={0} max={365} defaultValue={rule.threshold.value ?? ""} className="w-28" />
            </Field>
          ) : null}

          <div className="flex flex-col gap-3">
            <Field label="Title" error={errors.titleTemplate}>
              <Input
                ref={titleRef}
                name="titleTemplate"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onFocus={() => (focused.current = "title")}
                maxLength={200}
              />
            </Field>
            <Field label="Message" error={errors.bodyTemplate}>
              <Textarea
                ref={bodyRef}
                name="bodyTemplate"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onFocus={() => (focused.current = "body")}
                rows={3}
                maxLength={1000}
              />
            </Field>
            <div>
              <p className="mb-1 text-[11px] text-ink-faint">Insert a placeholder:</p>
              <div className="flex flex-wrap gap-1">
                {Object.keys(rule.placeholders).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => insert(p)}
                    className="rounded border border-line bg-sunk px-1.5 py-0.5 font-mono text-[11px] text-ink-soft hover:border-accent hover:text-accent"
                    title={`e.g. ${rule.placeholders[p]}`}
                  >
                    {`{{${p}}}`}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-medium text-ink-soft">Preview, with sample values</p>
            <div className="rounded-md border border-line bg-ground p-3">
              <div className="flex items-start gap-2.5 rounded bg-surface p-2.5 shadow-sm">
                <span className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" aria-hidden />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">{render(title, rule.placeholders) || "—"}</p>
                  {body ? <p className="mt-0.5 text-xs whitespace-pre-line text-ink-soft">{render(body, rule.placeholders)}</p> : null}
                  <p className="mt-1 text-[11px] text-ink-faint">just now</p>
                </div>
              </div>
              {email ? (
                <p className="mt-2 text-[11px] text-ink-faint">
                  <Mail className="mr-1 inline size-3" /> The email uses the title as its subject and the message as its text, with a link back.
                </p>
              ) : null}
            </div>
          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3">
          <div className="flex items-center gap-2">
            <Button type="submit" formAction={test} variant="secondary" disabled={testing}>
              {testing ? <Loader2 className="size-4 animate-spin" /> : <FlaskConical className="size-4" />}
              Send test to me
            </Button>
            {rule.isCustomised ? (
              <Button type="submit" formAction={reset} variant="ghost" disabled={resetting} title="Discard this organisation's changes">
                <RotateCcw className="size-4" /> Reset to default
              </Button>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              Save
            </Button>
          </div>
        </footer>
      </form>
    </div>
  );
}
