import Link from "next/link";
import { ShieldX } from "lucide-react";

export default function Forbidden() {
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="max-w-md text-center">
        <ShieldX className="mx-auto size-8 text-danger" aria-hidden />
        <h1 className="mt-4 text-lg font-semibold text-ink">You do not have access to this screen</h1>
        <p className="mt-2 text-sm text-ink-soft">
          Your roles do not include the permission this page requires. If you need it, ask an
          administrator to grant it to one of your roles.
        </p>
        <Link
          href="/dashboard"
          className="mt-5 inline-flex items-center rounded border border-line bg-surface px-3 py-1.5 text-sm text-ink hover:bg-sunk"
        >
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}
