import "server-only";

import type { ModuleId, PortMap } from "./ports";

/**
 * The module registry: what is installed, what booted, and what each module
 * exposes to the others.
 *
 * The guarantee this file exists to provide: **a module that fails cannot stop
 * another module from working.** It delivers that in three ways.
 *
 *   1. Registration is isolated. `register()` catches anything a module throws
 *      while building its port, records the module as `failed`, and returns. The
 *      next module still registers.
 *   2. Resolution is nullable. `resolve("attendance")` returns `null` when
 *      attendance is missing, failed or disabled, so every consumer is forced by
 *      the type system to decide what it does without it.
 *   3. Calls are wrapped. A port method that throws is converted at the boundary
 *      into a null/empty result and the module is marked degraded, rather than
 *      the exception propagating into the caller's transaction.
 *
 * There is no dependency injection container and no lifecycle framework here on
 * purpose. Modules are wired by importing `boot.ts` once; everything else is a
 * plain map.
 */

export type ModuleState = "ready" | "degraded" | "failed" | "not_installed";

export type ModuleHealth = {
  id: ModuleId;
  state: ModuleState;
  version: string;
  detail: string;
  /** Ports it needs. A missing hard requirement downgrades it to `failed`. */
  requires: readonly ModuleId[];
  /** Ports it uses when present. A missing one downgrades it to `degraded`. */
  optional: readonly ModuleId[];
  lastError: string | null;
  registeredAt: Date | null;
};

export type ModuleDescriptor<K extends ModuleId> = {
  id: K;
  version: string;
  requires?: readonly ModuleId[];
  optional?: readonly ModuleId[];
  /** Built lazily so a module that throws while constructing its port is contained. */
  port: () => PortMap[K];
};

type Entry = {
  id: ModuleId;
  version: string;
  requires: readonly ModuleId[];
  optional: readonly ModuleId[];
  port: unknown | null;
  state: ModuleState;
  lastError: string | null;
  registeredAt: Date | null;
};

// Next re-evaluates modules on every hot reload; without a global the registry
// would be rebuilt per request and boot would run again on each one.
const globalForKernel = globalThis as unknown as {
  __erpModules?: Map<ModuleId, Entry>;
  __erpDisabled?: Set<string>;
};

const modules: Map<ModuleId, Entry> = (globalForKernel.__erpModules ??= new Map());

/** `${orgId}:${moduleId}` for modules an organisation has switched off. */
const disabled: Set<string> = (globalForKernel.__erpDisabled ??= new Set());

/**
 * Installs a module. Never throws: a module that cannot build its port is
 * recorded as failed and the rest of the system boots without it.
 */
export function register<K extends ModuleId>(descriptor: ModuleDescriptor<K>): void {
  const base: Entry = {
    id: descriptor.id,
    version: descriptor.version,
    requires: descriptor.requires ?? [],
    optional: descriptor.optional ?? [],
    port: null,
    state: "failed",
    lastError: null,
    registeredAt: new Date(),
  };

  try {
    base.port = descriptor.port();
    base.state = "ready";
  } catch (error) {
    base.lastError = error instanceof Error ? error.message : String(error);
    console.error(`[kernel] module "${descriptor.id}" failed to register:`, error);
  }

  modules.set(descriptor.id, base);
}

/**
 * The port for a module, or `null` when it is unavailable. Callers must handle
 * null — that is the entire point of the return type.
 *
 * `orgId` is optional: pass it wherever the caller knows it, so a module
 * switched off for one organisation is invisible to that organisation only.
 */
export function resolve<K extends ModuleId>(id: K, orgId?: string): PortMap[K] | null {
  const entry = modules.get(id);
  if (!entry || !entry.port) return null;
  if (entry.state === "failed") return null;
  if (orgId && disabled.has(`${orgId}:${id}`)) return null;

  // Hard requirements are checked at call time rather than boot time, because a
  // dependency can fail later than this module did.
  for (const dep of entry.requires) {
    const depEntry = modules.get(dep);
    if (!depEntry || depEntry.state === "failed") return null;
  }

  return entry.port as PortMap[K];
}

/**
 * Resolve or throw. Reserve this for the rare case where continuing without the
 * module would produce wrong data rather than less data — never for rendering.
 */
export function requirePort<K extends ModuleId>(id: K, orgId?: string): PortMap[K] {
  const port = resolve(id, orgId);
  if (!port) throw new ModuleUnavailableError(id);
  return port;
}

export class ModuleUnavailableError extends Error {
  constructor(readonly moduleId: ModuleId) {
    super(`Module "${moduleId}" is unavailable`);
    this.name = "ModuleUnavailableError";
  }
}

/**
 * Runs a cross-module call with the boundary rules applied: a throw becomes the
 * supplied fallback, and the callee is marked degraded so it shows up on the
 * health screen instead of failing silently.
 *
 * Use this at *every* call site that crosses a module boundary. It is the
 * difference between "leave is slow because attendance is down" and "leave is
 * down because attendance is down".
 */
export async function callPort<K extends ModuleId, T>(
  id: K,
  fallback: T,
  fn: (port: PortMap[K]) => Promise<T>,
  orgId?: string,
): Promise<T> {
  const port = resolve(id, orgId);
  if (!port) return fallback;

  try {
    return await fn(port);
  } catch (error) {
    markDegraded(id, error);
    return fallback;
  }
}

export function markDegraded(id: ModuleId, error: unknown): void {
  const entry = modules.get(id);
  if (!entry) return;
  entry.state = "degraded";
  entry.lastError = error instanceof Error ? error.message : String(error);
  console.error(`[kernel] module "${id}" degraded:`, error);
}

/** Clears a degraded flag after a successful call or an operator reset. */
export function markHealthy(id: ModuleId): void {
  const entry = modules.get(id);
  if (!entry || entry.state === "failed") return;
  entry.state = "ready";
  entry.lastError = null;
}

/** Records which modules an organisation has switched off. Called once per request from the session layer. */
export function applyOrgModuleStates(
  orgId: string,
  states: { moduleId: string; isEnabled: boolean }[],
): void {
  for (const s of states) {
    const key = `${orgId}:${s.moduleId}`;
    if (s.isEnabled) disabled.delete(key);
    else disabled.add(key);
  }
}

export function isEnabled(id: ModuleId, orgId?: string): boolean {
  return resolve(id, orgId) !== null;
}

/** Everything the Administration health screen needs. */
export function health(orgId?: string): ModuleHealth[] {
  const ids = [...modules.keys()].sort();
  return ids.map((id) => {
    const entry = modules.get(id)!;
    const switchedOff = orgId ? disabled.has(`${orgId}:${id}`) : false;
    const missingRequired = entry.requires.filter((d) => {
      const dep = modules.get(d);
      return !dep || dep.state === "failed";
    });
    const missingOptional = entry.optional.filter((d) => !resolve(d, orgId));

    let state: ModuleState = entry.state;
    let detail = "Running.";
    if (switchedOff) {
      state = "not_installed";
      detail = "Switched off for this organisation.";
    } else if (missingRequired.length > 0) {
      state = "failed";
      detail = `Needs ${missingRequired.join(", ")}, which is unavailable.`;
    } else if (entry.state === "degraded") {
      detail = entry.lastError ?? "A cross-module call failed.";
    } else if (missingOptional.length > 0) {
      state = "degraded";
      detail = `Running without ${missingOptional.join(", ")}.`;
    } else if (entry.state === "failed") {
      detail = entry.lastError ?? "Failed to register.";
    }

    return {
      id,
      state,
      version: entry.version,
      detail,
      requires: entry.requires,
      optional: entry.optional,
      lastError: entry.lastError,
      registeredAt: entry.registeredAt,
    };
  });
}

/** Test seam: drops every registration. Not used by the application. */
export function __resetRegistry(): void {
  modules.clear();
  disabled.clear();
}
