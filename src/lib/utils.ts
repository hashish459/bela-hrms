import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Formats a numeric string from the database without float drift. */
export function formatDays(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "0";
  const n = typeof value === "string" ? Number.parseFloat(value) : value;
  if (Number.isNaN(n)) return "0";
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, "");
}

/** Nepalese rupee formatting, lakh/crore grouping. */
export function formatNpr(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "string" ? Number.parseFloat(value) : value;
  if (Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "NPR",
    maximumFractionDigits: 0,
  }).format(n);
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "Thu 16 Jul" for an AD calendar date (YYYY-MM-DD).
 *
 * Deliberately not toLocaleDateString: Node and the browser ship different ICU
 * data ("Thu, 16 Jul" vs "Thu 16 Jul"), and a client component rendered on the
 * server would then hydrate with different text. Read in UTC so the viewer's
 * timezone cannot move a calendar date either.
 */
export function formatAdDate(iso: string, opts: { weekday?: boolean } = {}): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = String(d.getUTCDate()).padStart(2, "0");
  const text = `${day} ${MONTH[d.getUTCMonth()]}`;
  return opts.weekday ? `${WEEKDAY[d.getUTCDay()]} ${text}` : text;
}
