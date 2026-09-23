"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { APP } from "@/lib/branding";
import { BrandMark } from "@/components/brand";
import type { NavModule } from "@/components/app-nav";

/** Nepal time as "14:05", taken when the print dialog opens. */
function nptNow() {
  const d = new Date(Date.now() + (5 * 60 + 45) * 60_000);
  return d.toISOString().slice(11, 16);
}

/**
 * The letterhead every printed page carries: the company mark and name, the
 * report's title, and who printed it when. Invisible on screen — it exists only
 * under `print:`, so any page printed with Ctrl/⌘ P, or a report's Print / PDF
 * button, comes out as a proper company document rather than a screenshot.
 */
export function PrintLetterhead({
  modules,
  viewer,
}: {
  modules: NavModule[];
  viewer: { name: string; orgName: string; todayBs: string; todayAd: string; fiscalYear: string | null };
}) {
  const pathname = usePathname();
  const [time, setTime] = useState<string | null>(null);

  useEffect(() => {
    const stampIt = () => setTime(nptNow());
    window.addEventListener("beforeprint", stampIt);
    return () => window.removeEventListener("beforeprint", stampIt);
  }, []);

  // the most specific nav entry for this route names the document
  const where = useMemo(() => {
    let best: { module: string; label: string; len: number } | null = null;
    for (const m of modules) {
      for (const s of m.sections) {
        for (const i of s.items) {
          const hit = pathname === i.href || pathname.startsWith(`${i.href}/`);
          if (hit && (!best || i.href.length > best.len)) best = { module: m.label, label: i.label, len: i.href.length };
        }
      }
    }
    return best;
  }, [modules, pathname]);

  const title = where ? where.label : pathname === "/dashboard" ? "Dashboard" : APP.name;

  return (
    <>
      <header className="mb-5 hidden items-center gap-4 border-b-2 border-accent pb-3 print:flex" aria-hidden>
        <BrandMark size="lg" />
        <div className="min-w-0 flex-1">
          <p className="text-lg leading-tight font-semibold text-ink">{viewer.orgName || APP.company}</p>
          <p className="text-[11px] text-ink-soft">{APP.companyNepali}</p>
          <p className="text-[10px] text-ink-faint">{APP.fullName}</p>
        </div>
        <div className="text-right">
          <p className="text-base font-semibold text-ink">{title}</p>
          {where ? <p className="text-[11px] text-ink-soft">{where.module}</p> : null}
          <p className="tabular mt-1 text-[10px] text-ink-faint">
            Printed {viewer.todayBs} BS · {viewer.todayAd}
            {time ? ` · ${time} NPT` : ""}
          </p>
          <p className="text-[10px] text-ink-faint">
            by {viewer.name}
            {viewer.fiscalYear ? ` · FY ${viewer.fiscalYear}` : ""}
          </p>
        </div>
      </header>

      <footer className="print-footer hidden text-[9px] text-ink-faint print:flex" aria-hidden>
        <span>
          © {APP.copyrightYear} {APP.companyLegal} · Confidential — for internal use
        </span>
        <span>
          {APP.name} v{APP.version}
        </span>
      </footer>
    </>
  );
}
