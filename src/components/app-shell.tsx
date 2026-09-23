"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronsLeft, ChevronsRight, Keyboard, LogOut, Menu, X } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { APP } from "@/lib/branding";
import { cn } from "@/lib/utils";
import { usePersistedFlag } from "@/lib/persisted";
import { Breadcrumb, SidebarNav, type NavModule } from "@/components/app-nav";
import { BrandLockup } from "@/components/brand";
import { ThemeToggle } from "@/components/appearance-controls";
import { Clock } from "@/components/clock";
import { RoleSwitcher } from "@/components/role-switcher";
import { NotificationBell } from "@/components/notification-bell";
import { KeyboardShortcuts } from "@/components/keyboard-shortcuts";
import { PrintLetterhead } from "@/components/print-letterhead";
import type { BellSummary } from "@/app/(app)/me/notifications/actions";

const RAIL_KEY = "bela-hrms.nav.railed";

export function AppShell({
  modules,
  viewer,
  counts,
  notifications,
  children,
}: {
  modules: NavModule[];
  viewer: {
    name: string;
    email: string;
    orgName: string;
    roleNames: string[];
    isSystemAdmin: boolean;
    actingAs: { id: string; name: string } | null;
    switchableRoles: { id: string; code: string; name: string }[];
    fiscalYear: string | null;
    todayBs: string;
    todayAd: string;
  };
  counts?: Record<string, number>;
  notifications: BellSummary;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [drawer, setDrawer] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  // The server renders the expanded sidebar; the stored preference arrives on the
  // next commit without a hydration mismatch. See lib/persisted.
  const [railed, setRailed] = usePersistedFlag(RAIL_KEY, false);

  async function handleSignOut() {
    setSigningOut(true);
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  }

  const initials = viewer.name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only z-[70] rounded bg-accent px-3 py-2 text-sm font-medium text-on-accent focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <KeyboardShortcuts modules={modules} onToggleSidebar={() => setRailed(!railed)} />
      {/* ------------------------------------------------------------ header */}
      <header className="sticky top-0 z-40 flex h-12 print:hidden shrink-0 items-center gap-2 border-b border-line bg-surface px-3">
        <button
          type="button"
          onClick={() => setDrawer(true)}
          className="rounded p-1.5 text-ink-soft hover:bg-sunk hover:text-ink md:hidden"
          aria-label="Open navigation"
        >
          <Menu className="size-5" />
        </button>

        <Link href="/dashboard" className="flex items-center gap-2 pr-1" aria-label={`${APP.name} home`}>
          <BrandLockup />
        </Link>

        <button
          type="button"
          onClick={() => setRailed(!railed)}
          className="hidden rounded p-1.5 text-ink-faint hover:bg-sunk hover:text-ink md:inline-flex"
          aria-label={railed ? "Expand sidebar" : "Collapse sidebar"}
          title={railed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {railed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
        </button>

        {/*
          The company name, centred.

          In flow with a `flex-1` spacer rather than absolutely positioned. The
          absolute version centred it on the page exactly — and then the role
          switcher joined the right-hand cluster and the title ran straight
          underneath it. Centring within the space that is actually free is a
          hair off true centre and cannot collide, which is the better trade for
          a bar whose contents change with permissions.
        */}
        <div className="hidden min-w-0 flex-1 px-4 text-center lg:block">
          <p className="truncate text-sm font-semibold tracking-tight text-ink">
            {viewer.orgName}
          </p>
          <p className="truncate text-[10px] leading-tight text-ink-faint">{APP.fullName}</p>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <div className="hidden text-right lg:block">
            <p className="tabular text-[11px] leading-tight text-ink-soft">{viewer.todayBs} BS</p>
            <p className="tabular text-[11px] leading-tight text-ink-faint">{viewer.todayAd}</p>
          </div>

          {/*
            Sized to sit level with the two date lines rather than shouting: a
            clock people glance at while filling a punch correction, not a
            feature. NPT is stated because the figure is only meaningful with it.
          */}
          <div className="hidden text-right sm:block">
            <Clock className="tabular block text-[13px] leading-tight font-semibold text-ink" />
            <span className="block text-[10px] leading-tight text-ink-faint">NPT</span>
          </div>

          {viewer.fiscalYear ? (
            <span className="tabular hidden rounded bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-accent sm:inline">
              FY {viewer.fiscalYear}
            </span>
          ) : null}

          <RoleSwitcher roles={viewer.switchableRoles} actingAs={viewer.actingAs} />

          <NotificationBell initial={notifications} />

          <button
            type="button"
            onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }))}
            className="hidden items-center gap-1.5 rounded border border-line px-2 py-1 text-[11px] text-ink-faint hover:bg-sunk hover:text-ink md:inline-flex"
            title="Go to any screen (Ctrl K) · all shortcuts (?)"
            aria-label="Open the command palette"
            aria-keyshortcuts="Control+K Meta+K"
          >
            <Keyboard className="size-3.5" aria-hidden />
            <span className="font-mono">Ctrl K</span>
          </button>

          <ThemeToggle />

          <div className="flex items-center gap-2 border-l border-line pl-3">
            <span
              className="grid size-7 shrink-0 place-items-center rounded-full bg-sunk text-[11px] font-semibold text-ink-soft"
              aria-hidden
            >
              {initials}
            </span>
            <div className="hidden text-right sm:block">
              <p className="text-xs leading-tight font-medium text-ink">{viewer.name}</p>
              {/*
                The role never changes; a "viewing as" badge is appended beside
                it. Replacing the label was how an administrator ended up
                displayed as an employee.
              */}
              <p className="flex max-w-44 items-center justify-end gap-1 text-[11px] leading-tight">
                <span className="truncate text-ink-faint">
                  {viewer.roleNames.join(", ") || "No role"}
                </span>
                {viewer.actingAs ? (
                  <span className="shrink-0 rounded bg-warn-soft px-1 font-medium text-warn">
                    as {viewer.actingAs.name}
                  </span>
                ) : null}
              </p>
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              disabled={signingOut}
              className="rounded p-1.5 text-ink-soft hover:bg-sunk hover:text-ink disabled:opacity-50"
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </header>

      <div className="flex flex-1">
        {/* --------------------------------------------------------- sidebar */}
        <aside
          className={cn(
            "sticky top-12 hidden h-[calc(100vh-3rem)] shrink-0 border-r border-line bg-surface md:block print:hidden",
            "transition-[width] duration-150 ease-out",
            railed ? "w-14" : "w-64",
          )}
        >
          <SidebarNav
            modules={modules}
            railed={railed}
            counts={counts}
            onUnrail={() => setRailed(false)}
            onNavigate={() => {}}
          />
        </aside>

        {/* ---------------------------------------------------- mobile drawer */}
        {drawer ? (
          <div className="fixed inset-0 z-50 md:hidden">
            <button
              type="button"
              aria-label="Close navigation"
              onClick={() => setDrawer(false)}
              className="absolute inset-0 bg-ink/40"
            />
            <div className="absolute inset-y-0 left-0 flex w-72 flex-col border-r border-line bg-surface">
              <div className="flex h-12 shrink-0 items-center justify-between border-b border-line px-3">
                <BrandLockup />
                <button
                  type="button"
                  onClick={() => setDrawer(false)}
                  className="rounded p-1.5 text-ink-soft hover:bg-sunk"
                  aria-label="Close navigation"
                >
                  <X className="size-4" />
                </button>
              </div>
              <SidebarNav
                modules={modules}
                railed={false}
                counts={counts}
                onUnrail={() => {}}
                onNavigate={() => setDrawer(false)}
              />
            </div>
          </div>
        ) : null}

        {/* ------------------------------------------------------------ main */}
        <div className="flex min-w-0 flex-1 flex-col">
          <main id="main" tabIndex={-1} className="flex-1 px-4 py-5 outline-none md:px-6 print:p-0">
            <PrintLetterhead modules={modules} viewer={viewer} />
            <div className="print:hidden">
              <Breadcrumb modules={modules} />
            </div>
            {children}
          </main>

          <footer className="border-t border-line px-4 py-3 md:px-6 print:hidden">
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-faint">
              <span>
                © {APP.copyrightYear} {APP.company}
              </span>
              <span aria-hidden>·</span>
              <span>
                {APP.name} v{APP.version}
              </span>
              <span aria-hidden>·</span>
              <span className="tabular">
                {viewer.todayBs} BS / {viewer.todayAd}
              </span>
              <span aria-hidden>·</span>
              <Clock className="tabular" />
              {viewer.fiscalYear ? (
                <>
                  <span aria-hidden>·</span>
                  <span className="tabular">FY {viewer.fiscalYear}</span>
                </>
              ) : null}
            </p>
          </footer>
        </div>
      </div>
    </div>
  );
}
