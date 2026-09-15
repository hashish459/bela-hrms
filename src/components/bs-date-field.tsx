"use client";

import { useId, useState } from "react";
import { adToBs, bsToAd, formatBsKey, parseBsKey } from "@/lib/bs";

/**
 * Paired Bikram Sambat / Gregorian date input.
 *
 * Nepali staff think and file in BS; the database stores Gregorian so that
 * ordering and range queries behave. Rather than pick one and make somebody
 * translate in their head, both are editable and each keeps the other in step.
 * The submitted value is always the Gregorian ISO date.
 */
export function BsDateField({
  name,
  bsName,
  label,
  defaultValue = "",
  required,
  error,
  hint,
}: {
  name: string;
  /** Also submit the Bikram Sambat key under this name, for actions that store it. */
  bsName?: string;
  label: string;
  /** Gregorian ISO date, or "" */
  defaultValue?: string;
  required?: boolean;
  error?: string;
  hint?: string;
}) {
  const id = useId();
  const [ad, setAd] = useState(defaultValue);
  const [bs, setBs] = useState(() => {
    if (!defaultValue) return "";
    try {
      return formatBsKey(adToBs(defaultValue));
    } catch {
      return "";
    }
  });
  const [localError, setLocalError] = useState<string | null>(null);

  function onBsChange(value: string) {
    setBs(value);
    if (!value) {
      setAd("");
      setLocalError(null);
      return;
    }
    const parsed = parseBsKey(value);
    if (!parsed) {
      setLocalError("Use YYYY-MM-DD within BS 2000–2100");
      return;
    }
    setLocalError(null);
    setAd(bsToAd(parsed));
  }

  function onAdChange(value: string) {
    setAd(value);
    if (!value) {
      setBs("");
      setLocalError(null);
      return;
    }
    try {
      setBs(formatBsKey(adToBs(value)));
      setLocalError(null);
    } catch {
      setLocalError("Outside the supported calendar range");
    }
  }

  const shown = error ?? localError;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-ink-soft">
        {label}
        {required ? <span className="ml-0.5 text-danger">*</span> : null}
      </label>

      <div className="grid grid-cols-2 gap-1.5">
        <div className="relative">
          <input
            id={id}
            value={bs}
            onChange={(e) => onBsChange(e.target.value)}
            placeholder="2083-05-22"
            inputMode="numeric"
            aria-label={`${label}, Bikram Sambat`}
            className="tabular w-full rounded border border-line bg-surface py-1.5 pr-10 pl-2.5 text-sm text-ink placeholder:text-ink-faint"
          />
          <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[10px] font-medium text-ink-faint">
            BS
          </span>
        </div>

        <div className="relative">
          <input
            type="date"
            value={ad}
            onChange={(e) => onAdChange(e.target.value)}
            aria-label={`${label}, Gregorian`}
            className="tabular w-full rounded border border-line bg-surface px-2.5 py-1.5 text-sm text-ink"
          />
        </div>
      </div>

      {/* what the server action reads */}
      <input type="hidden" name={name} value={ad} />
      {bsName ? <input type="hidden" name={bsName} value={bs} /> : null}

      {shown ? (
        <span className="text-xs text-danger">{shown}</span>
      ) : hint ? (
        <span className="text-xs text-ink-faint">{hint}</span>
      ) : null}
    </div>
  );
}
