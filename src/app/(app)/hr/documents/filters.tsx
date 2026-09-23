"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Search, X } from "lucide-react";
import { Select } from "@/components/ui";
import { DOCUMENT_KINDS, documentKindLabel } from "./kinds";

/**
 * Filters for the register.
 *
 * They live in the URL, so "everything expiring this quarter" is a link
 * somebody can send to the person who has to chase it — which is most of the
 * point of an expiry register.
 */

const EXPIRY_OPTIONS = [
  { value: "", label: "Any expiry" },
  { value: "attention", label: "Needs attention" },
  { value: "expired", label: "Expired" },
  { value: "expiring", label: "Expiring soon" },
  { value: "none", label: "No expiry date" },
];

const STATUS_OPTIONS = [
  { value: "", label: "Any status" },
  { value: "pending", label: "Pending check" },
  { value: "verified", label: "Verified" },
  { value: "rejected", label: "Rejected" },
];

export function DocumentFilters() {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function update(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    // Any filter change invalidates the page number: page 4 of the old result
    // set is rarely page 4 of the new one, and is often past the end.
    next.delete("page");
    startTransition(() => router.replace(`/hr/documents?${next.toString()}`));
  }

  const q = params.get("q") ?? "";
  const kind = params.get("kind") ?? "";
  const status = params.get("status") ?? "";
  const expiry = params.get("expiry") ?? "";
  const dirty = Boolean(q || kind || status || expiry);

  return (
    <div className="flex flex-wrap items-center gap-2" data-pending={pending ? "" : undefined}>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-ink-faint" />
        <input
          type="search"
          defaultValue={q}
          placeholder="Employee, title or reference"
          onChange={(e) => update("q", e.target.value)}
          className="w-64 rounded border border-line bg-surface py-1.5 pr-2.5 pl-7 text-sm text-ink placeholder:text-ink-faint"
        />
      </div>

      <Select value={kind} onChange={(e) => update("kind", e.target.value)} className="w-44">
        <option value="">All types</option>
        {DOCUMENT_KINDS.map((k) => (
          <option key={k} value={k}>
            {documentKindLabel(k)}
          </option>
        ))}
      </Select>

      <Select value={expiry} onChange={(e) => update("expiry", e.target.value)} className="w-44">
        {EXPIRY_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>

      <Select value={status} onChange={(e) => update("status", e.target.value)} className="w-44">
        {STATUS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>

      {dirty ? (
        <button
          type="button"
          onClick={() => startTransition(() => router.replace("/hr/documents"))}
          className="inline-flex items-center gap-1 rounded px-2 py-1.5 text-xs text-ink-faint hover:bg-sunk hover:text-ink"
        >
          <X className="size-3.5" />
          Clear
        </button>
      ) : null}
    </div>
  );
}
