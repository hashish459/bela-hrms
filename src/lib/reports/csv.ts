/**
 * CSV for report exports.
 *
 * RFC 4180 quoting, CRLF line ends, and a UTF-8 byte-order mark. The BOM is not
 * decoration: without it Excel on Windows opens the file as ANSI and every
 * Devanagari name turns into mojibake — which is the first thing a Nepali HR
 * office does with an export.
 *
 * Cells that begin with `=`, `+`, `-` or `@` are prefixed with an apostrophe so a
 * name or remark cannot execute as a spreadsheet formula (CSV injection). Numbers
 * are written as numbers and are not touched.
 */

export type CsvValue = string | number | null | undefined;

export type CsvColumn<T> = {
  header: string;
  value: (row: T) => CsvValue;
};

function cell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";

  let text = value;
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const lines = [columns.map((c) => cell(c.header)).join(",")];
  for (const row of rows) lines.push(columns.map((c) => cell(c.value(row))).join(","));
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/** A download response with a safe filename. */
export function csvResponse(body: string, filename: string): Response {
  const safe = filename.replace(/[^A-Za-z0-9._-]+/g, "-");
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safe}"`,
      "Cache-Control": "no-store",
    },
  });
}
