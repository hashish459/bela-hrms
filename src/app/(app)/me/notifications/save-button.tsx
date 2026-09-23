"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui";

/** A submit button that says when the save landed. */
export function SaveButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  const [saved, setSaved] = useState(false);
  const was = useRef(false);
  useEffect(() => {
    if (was.current && !pending) {
      setSaved(true);
      const t = window.setTimeout(() => setSaved(false), 2500);
      return () => window.clearTimeout(t);
    }
    was.current = pending;
  }, [pending]);
  return (
    <div className="flex items-center gap-3">
      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        {children}
      </Button>
      {saved ? (
        <span className="inline-flex items-center gap-1 text-sm text-ok" role="status">
          <CheckCircle2 className="size-4" /> Saved
        </span>
      ) : null}
    </div>
  );
}
