"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, Bell, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Product-wide feedback: a yes/no confirmation dialog and toasts.
 *
 * Replaces the browser's `confirm()` — which cannot be styled, blocks the
 * page, and reads like an error on some systems — with a dialog that says
 * what will happen, names the action on its button, and is keyboard- and
 * screen-reader-friendly (focus moves in, Escape cancels, Enter confirms,
 * Tab stays inside). Toasts carry the outcome of an action and live
 * notifications, stacked bottom-right, and pause while hovered.
 */

export type Tone = "info" | "success" | "warning" | "danger";

export type ConfirmOptions = {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger" | "warning";
};

export type ToastInput = {
  title: string;
  body?: string | null;
  tone?: Tone;
  href?: string | null;
  /** Milliseconds; 0 keeps it until dismissed. */
  duration?: number;
};

type Toast = ToastInput & { id: number };

type Feedback = {
  confirm: (o: ConfirmOptions) => Promise<boolean>;
  toast: (t: ToastInput) => void;
};

const FeedbackContext = createContext<Feedback | null>(null);

/** Outside the provider (a login page, a test) degrade to the browser's own. */
const fallback: Feedback = {
  confirm: async (o) => window.confirm(o.title),
  toast: () => {},
};

export function useFeedback(): Feedback {
  return useContext(FeedbackContext) ?? fallback;
}

export const useConfirm = () => useFeedback().confirm;
export const useToast = () => useFeedback().toast;

/**
 * An `onSubmit` for a form that must be confirmed first. The submit is held,
 * the dialog asked, and on "yes" the same form is re-submitted with the same
 * submit button — so its name/value (an intent like "submit" or "purge")
 * still reaches the action.
 *
 * `options` may be a function of the button pressed; returning null lets
 * that submit through unasked.
 */
export function useConfirmSubmit(options: ConfirmOptions | ((submitter: HTMLButtonElement | null) => ConfirmOptions | null)) {
  const confirm = useConfirm();
  return useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      const form = e.currentTarget;
      if (form.dataset.confirmed === "1") {
        delete form.dataset.confirmed;
        return;
      }
      const submitter = ((e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null) ?? null;
      const opts = typeof options === "function" ? options(submitter) : options;
      if (!opts) return;
      e.preventDefault();
      void confirm(opts).then((ok) => {
        if (!ok) return;
        form.dataset.confirmed = "1";
        form.requestSubmit(submitter ?? undefined);
      });
    },
    [confirm, options],
  );
}

const TONE_ICON = { info: Info, success: CheckCircle2, warning: AlertTriangle, danger: XCircle } as const;
const TONE_CLASS: Record<Tone, string> = {
  info: "text-info",
  success: "text-ok",
  warning: "text-warn",
  danger: "text-danger",
};
const TONE_BAR: Record<Tone, string> = {
  info: "bg-info",
  success: "bg-ok",
  warning: "bg-warn",
  danger: "bg-danger",
};

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const confirm = useCallback(
    (o: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setDialog({ ...o, resolve });
      }),
    [],
  );

  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);

  const toast = useCallback((t: ToastInput) => {
    const id = ++seq.current;
    // newest on top, and never more than four on screen
    setToasts((ts) => [{ ...t, id }, ...ts].slice(0, 4));
  }, []);

  const value = useMemo(() => ({ confirm, toast }), [confirm, toast]);

  const close = (answer: boolean) => {
    dialog?.resolve(answer);
    setDialog(null);
  };

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      {dialog ? <ConfirmDialog options={dialog} onAnswer={close} /> : null}
      <div
        className="pointer-events-none fixed right-4 bottom-4 z-[80] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2 print:hidden"
        aria-live="polite"
        aria-relevant="additions"
      >
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </FeedbackContext.Provider>
  );
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const tone = toast.tone ?? "info";
  const Icon = toast.href ? Bell : TONE_ICON[tone];
  const duration = toast.duration ?? (tone === "danger" ? 8000 : 5000);
  const [paused, setPaused] = useState(false);
  const [shown, setShown] = useState(false);
  const left = useRef(duration);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (!duration || paused) return;
    const started = Date.now();
    const timer = window.setTimeout(onDismiss, left.current);
    return () => {
      window.clearTimeout(timer);
      left.current -= Date.now() - started;
    };
  }, [paused, duration, onDismiss]);

  const inner = (
    <>
      <Icon className={cn("mt-0.5 size-4 shrink-0", TONE_CLASS[tone])} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">{toast.title}</p>
        {toast.body ? <p className="mt-0.5 line-clamp-3 text-xs whitespace-pre-line text-ink-soft">{toast.body}</p> : null}
      </div>
    </>
  );

  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={cn(
        "pointer-events-auto relative flex gap-3 overflow-hidden rounded-lg border border-line bg-surface p-3 pr-9 shadow-lg transition-all duration-300",
        shown ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
      )}
    >
      <span className={cn("absolute inset-y-0 left-0 w-1", TONE_BAR[tone])} aria-hidden />
      {toast.href ? (
        <Link href={toast.href} onClick={onDismiss} className="flex min-w-0 flex-1 gap-3 hover:opacity-90">
          {inner}
        </Link>
      ) : (
        inner
      )}
      <button type="button" onClick={onDismiss} className="absolute top-2 right-2 rounded p-1 text-ink-faint hover:bg-sunk hover:text-ink" aria-label="Dismiss">
        <X className="size-3.5" />
      </button>
      {duration && !paused ? (
        <span
          className={cn("absolute bottom-0 left-0 h-0.5 opacity-40", TONE_BAR[tone])}
          style={{ animation: `toast-progress ${duration}ms linear forwards` }}
          aria-hidden
        />
      ) : null}
    </div>
  );
}

function ConfirmDialog({ options, onAnswer }: { options: ConfirmOptions; onAnswer: (v: boolean) => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const yes = useRef<HTMLButtonElement>(null);
  const tone = options.tone ?? "default";

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    yes.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onAnswer(false);
      }
      if (e.key === "Tab" && panel.current) {
        const f = panel.current.querySelectorAll<HTMLElement>("button");
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [onAnswer]);

  const Icon = tone === "danger" ? XCircle : tone === "warning" ? AlertTriangle : Info;

  return (
    <div className="fixed inset-0 z-[90] grid place-items-center p-4 print:hidden" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-body">
      <button type="button" tabIndex={-1} aria-label="Cancel" onClick={() => onAnswer(false)} className="absolute inset-0 animate-[fade-in_150ms_ease-out] bg-ink/40 backdrop-blur-[2px]" />
      <div ref={panel} className="relative w-full max-w-md animate-[pop-in_160ms_ease-out] rounded-xl border border-line bg-surface p-5 shadow-2xl">
        <div className="flex gap-4">
          <span
            className={cn(
              "grid size-10 shrink-0 place-items-center rounded-full",
              tone === "danger" ? "bg-danger-soft text-danger" : tone === "warning" ? "bg-warn-soft text-warn" : "bg-accent-soft text-accent",
            )}
          >
            <Icon className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="confirm-title" className="text-base font-semibold text-ink">
              {options.title}
            </h2>
            {options.body ? (
              <div id="confirm-body" className="mt-1.5 text-sm text-ink-soft">
                {options.body}
              </div>
            ) : null}
          </div>
        </div>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => onAnswer(false)}
            className="rounded-md border border-line px-4 py-2 text-sm font-medium text-ink-soft hover:bg-sunk hover:text-ink"
          >
            {options.cancelLabel ?? "Cancel"}
          </button>
          <button
            ref={yes}
            type="button"
            onClick={() => onAnswer(true)}
            className={cn(
              "rounded-md px-4 py-2 text-sm font-medium text-white shadow-sm",
              tone === "danger" ? "bg-danger hover:opacity-90" : tone === "warning" ? "bg-warn hover:opacity-90" : "bg-accent text-on-accent hover:bg-accent-hover",
            )}
          >
            {options.confirmLabel ?? "Yes, continue"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Shows the outcome of a `useActionState` action as a toast once per result.
 * Pass the state; it needs an `at` stamp so repeated identical results still
 * announce themselves.
 */
export function useActionToast(state: { ok?: string | boolean; error?: string; message?: string; at?: number }, opts?: { success?: string }) {
  const toast = useToast();
  const last = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!state.at || state.at === last.current) return;
    last.current = state.at;
    if (state.error) toast({ title: state.error, tone: "danger" });
    else if (state.ok) toast({ title: typeof state.ok === "string" ? state.ok : (opts?.success ?? state.message ?? "Done."), tone: "success" });
  }, [state, toast, opts?.success]);
}

/**
 * Wraps a server action so its outcome is toasted the moment it returns —
 * before the page re-renders. Use this rather than `useActionToast` when the
 * action's success removes the form itself (a claimed day leaving its list,
 * a submitted day turning read-only), which would unmount any effect.
 */
export function useToastedAction<S extends { ok?: string | boolean; error?: string }>(
  action: (prev: S, formData: FormData) => Promise<S>,
  opts: { errors?: boolean; success?: string } = {},
) {
  const toast = useToast();
  const { errors = false, success } = opts;
  return useCallback(
    async (prev: S, formData: FormData) => {
      const result = await action(prev, formData);
      if (result.error && errors) toast({ title: result.error, tone: "danger" });
      else if (result.ok) toast({ title: typeof result.ok === "string" ? result.ok : (success ?? "Done."), tone: "success" });
      return result;
    },
    [action, toast, errors, success],
  );
}
