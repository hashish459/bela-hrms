import { adToBs, formatBs, weekdayOf } from "@/lib/bs";

/** Deterministic labels — no locale APIs — so server and browser render the same text. */
const AD_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "23 Sep 2026" */
export function adLabel(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${AD_MONTHS[m - 1]} ${y}`;
}

/** "Wednesday · 7 Ashwin 2083" */
export function dayTitle(iso: string) {
  return `${WEEKDAYS[weekdayOf(iso)]} · ${formatBs(adToBs(iso))}`;
}

/** "14:05, 23 Sep 2026" in Nepal time, for submitted-at stamps. */
export function stamp(at: Date | null) {
  if (!at) return "";
  const npt = new Date(at.getTime() + (5 * 60 + 45) * 60_000);
  const iso = npt.toISOString();
  return `${iso.slice(11, 16)}, ${adLabel(iso.slice(0, 10))}`;
}
