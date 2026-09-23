"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Download, X, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A photograph shown full size over the page: click or press Z to zoom,
 * Escape or the backdrop to close, and a download of the original file.
 */
export function PhotoViewer({ src, name, caption, onClose }: { src: string; name: string; caption?: string; onClose: () => void }) {
  const [zoomed, setZoomed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const close = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    close.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "z" || e.key === "Z") setZoomed((z) => !z);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      previous?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[85] flex flex-col bg-ink/85 backdrop-blur-sm print:hidden" role="dialog" aria-modal="true" aria-label={`Photograph of ${name}`}>
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-white">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{name}</p>
          {caption ? <p className="truncate text-xs text-white/70">{caption}</p> : null}
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setZoomed((z) => !z)} className="rounded-full p-2 hover:bg-white/10" aria-label={zoomed ? "Zoom out" : "Zoom in"} title="Zoom (Z)">
            {zoomed ? <ZoomOut className="size-5" /> : <ZoomIn className="size-5" />}
          </button>
          <a href={src} download className="rounded-full p-2 hover:bg-white/10" aria-label="Download photograph" title="Download">
            <Download className="size-5" />
          </a>
          <button ref={close} type="button" onClick={onClose} className="rounded-full p-2 hover:bg-white/10" aria-label="Close" title="Close (Esc)">
            <X className="size-5" />
          </button>
        </div>
      </div>
      <div className={cn("relative flex flex-1 items-center justify-center p-4", zoomed ? "overflow-auto" : "overflow-hidden")} onClick={(e) => e.target === e.currentTarget && onClose()}>
        {!loaded ? <span className="absolute size-8 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden /> : null}
        {/* eslint-disable-next-line @next/next/no-img-element -- a private file behind the session check, see Avatar */}
        <img
          src={src}
          alt={`Photograph of ${name}`}
          onLoad={() => setLoaded(true)}
          onClick={() => setZoomed((z) => !z)}
          className={cn(
            "rounded-lg shadow-2xl transition-[transform,opacity] duration-200 select-none",
            loaded ? "opacity-100" : "opacity-0",
            zoomed ? "max-w-none scale-[1.8] cursor-zoom-out" : "max-h-[80vh] max-w-[min(90vw,48rem)] cursor-zoom-in object-contain",
          )}
          draggable={false}
        />
      </div>
    </div>
  );
}

/**
 * Wraps a face so it opens full size when clicked. With no photograph there
 * is nothing to enlarge, and the children render as they are.
 */
export function ZoomablePhoto({
  src,
  name,
  caption,
  children,
  className,
}: {
  src: string | null;
  name: string;
  caption?: string;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!src) return <>{children}</>;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn("group relative block cursor-zoom-in rounded-full focus-visible:outline-offset-4", className)}
        aria-label={`View ${name}'s photograph full size`}
        title="View full size"
      >
        {children}
        <span className="pointer-events-none absolute inset-0 grid place-items-center rounded-full bg-ink/0 text-white opacity-0 transition group-hover:bg-ink/35 group-hover:opacity-100" aria-hidden>
          <ZoomIn className="size-5" />
        </span>
      </button>
      {open ? <PhotoViewer src={src} name={name} caption={caption} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
