"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

/**
 * The right-hand panel every editor in the product opens: a form over a dimmed
 * page, closed by Escape, the scrim or the button. Focus moves into it on open
 * so a keyboard user lands on the first field, not behind the overlay.
 */
export function SideDrawer({
  title,
  subtitle,
  onClose,
  children,
  footer,
  action,
  width = "max-w-lg",
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** When set, the panel is a <form> posting to this action. */
  action?: (formData: FormData) => void;
  width?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const body = (
    <>
      <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-xs text-ink-faint">{subtitle}</p> : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-ink-faint hover:bg-sunk hover:text-ink"
          aria-label="Close"
        >
          <X className="size-4" />
        </button>
      </header>
      <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      {footer ? <footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer> : null}
    </>
  );

  const className = `absolute inset-y-0 right-0 flex w-full ${width} flex-col border-l border-line bg-surface shadow-2xl`;

  return (
    <div className="fixed inset-0 z-50 print:hidden" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-ink/30" />
      <div ref={panel}>
        {action ? (
          <form action={action} className={className}>
            {body}
          </form>
        ) : (
          <div className={className}>{body}</div>
        )}
      </div>
    </div>
  );
}
