"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Search, X } from "lucide-react";
import { Select } from "@/components/ui";

const STATUS_OPTIONS = [
  { value: "employed", label: "Currently employed" },
  { value: "all", label: "All statuses" },
  { value: "probation", label: "Probation" },
  { value: "active", label: "Active" },
  { value: "on_leave", label: "On leave" },
  { value: "suspended", label: "Suspended" },
  { value: "resigned", label: "Resigned" },
  { value: "terminated", label: "Terminated" },
  { value: "retired", label: "Retired" },
];

export function EmployeeFilters({
  departments,
  branches,
}: {
  departments: { id: string; name: string }[];
  branches: { id: string; name: string }[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  // Filters live in the URL so a filtered list can be bookmarked and shared,
  // and the back button behaves the way people expect.
  function update(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    startTransition(() => router.replace(`/hr/employees?${next.toString()}`));
  }

  const q = params.get("q") ?? "";
  const dept = params.get("dept") ?? "";
  const branch = params.get("branch") ?? "";
  const status = params.get("status") ?? "employed";
  const dirty = q || dept || branch || status !== "employed";

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-pending={pending ? "" : undefined}
    >
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-ink-faint" />
        <input
          type="search"
          defaultValue={q}
          placeholder="Name, code or email"
          onChange={(e) => update("q", e.target.value)}
          className="w-64 rounded border border-line bg-surface py-1.5 pr-2.5 pl-7 text-sm text-ink placeholder:text-ink-faint"
        />
      </div>

      <Select value={dept} onChange={(e) => update("dept", e.target.value)} className="w-52">
        <option value="">All departments</option>
        {departments.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </Select>

      <Select value={branch} onChange={(e) => update("branch", e.target.value)} className="w-44">
        <option value="">All branches</option>
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </Select>

      <Select value={status} onChange={(e) => update("status", e.target.value)} className="w-52">
        {STATUS_OPTIONS.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </Select>

      {dirty ? (
        <button
          type="button"
          onClick={() => startTransition(() => router.replace("/hr/employees"))}
          className="inline-flex items-center gap-1 rounded px-2 py-1.5 text-xs text-ink-faint hover:bg-sunk hover:text-ink"
        >
          <X className="size-3.5" />
          Clear
        </button>
      ) : null}
    </div>
  );
}
