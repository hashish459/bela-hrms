"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2 } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { Button, Field, Input } from "@/components/ui";
import { APP } from "@/lib/branding";
import { BrandMark } from "@/components/brand";
import { recordSignIn } from "./actions";

const DEMO_LOGINS = [
  { email: "admin@bela.example.np", password: "Admin@123", role: "Administrator" },
  { email: "sunita.maharjan@bela.example.np", password: "Hr@12345", role: "HR Manager" },
  { email: "gopal.neupane@bela.example.np", password: "Super@123", role: "Supervisor" },
  { email: "hari.bahadur@bela.example.np", password: "Staff@123", role: "Employee" },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("admin@bela.example.np");
  const [password, setPassword] = useState("Admin@123");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const { error } = await authClient.signIn.email({ email, password });

    if (error) {
      // Deliberately does not say which of the two was wrong.
      setError("That email and password combination was not recognised.");
      setBusy(false);
      return;
    }

    // stamp the sign-in before navigating, so Administration › Users is accurate
    await recordSignIn().catch(() => {});

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <BrandMark size="lg" />
          <p className="mt-3 text-base font-semibold tracking-tight text-ink">{APP.name}</p>
          <p className="text-xs text-ink-faint">{APP.company}</p>
        </div>

        <form
          onSubmit={submit}
          className="flex flex-col gap-4 rounded-md border border-line bg-surface p-5"
        >
          <div>
            <h1 className="text-base font-semibold text-ink">Sign in</h1>
            <p className="mt-0.5 text-xs text-ink-faint">
              Use your work email address.
            </p>
          </div>

          <Field label="Email" required>
            <Input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>

          <Field label="Password" required>
            <Input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>

          {error ? (
            <p className="flex items-start gap-1.5 rounded bg-danger-soft px-2.5 py-2 text-xs text-danger">
              <AlertCircle className="mt-px size-3.5 shrink-0" />
              {error}
            </p>
          ) : null}

          <Button type="submit" disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {busy ? "Signing in" : "Sign in"}
          </Button>
        </form>

        <div className="mt-4 rounded-md border border-line bg-sunk p-3">
          <p className="mb-2 text-[11px] font-medium tracking-wide text-ink-faint uppercase">
            Demo accounts
          </p>
          <ul className="flex flex-col gap-1">
            {DEMO_LOGINS.map((d) => (
              <li key={d.email}>
                <button
                  type="button"
                  onClick={() => {
                    setEmail(d.email);
                    setPassword(d.password);
                  }}
                  className="flex w-full items-baseline justify-between gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-surface"
                >
                  <span className="truncate text-ink-soft">{d.email}</span>
                  <span className="shrink-0 text-[11px] text-ink-faint">{d.role}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 px-1.5 text-[11px] text-ink-faint">
            Each role sees a different navigation tree — that is the permission system, not a
            hard-coded menu.
          </p>
        </div>

        <p className="mt-4 text-center text-[11px] text-ink-faint">
          © {APP.copyrightYear} {APP.companyLegal} · {APP.name} v{APP.version}
        </p>
      </div>
    </main>
  );
}
