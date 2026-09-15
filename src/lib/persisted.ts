"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * A tiny external store over localStorage.
 *
 * UI preferences that live in the browser — which nav modules are open, whether
 * the sidebar is railed — are read through `useSyncExternalStore` rather than
 * hydrated with a `setState` inside an effect. That is the sanctioned pattern for
 * this exact problem: the server snapshot is `null`, so the markup React renders
 * on the server and on the first client pass agree, and the stored value is
 * applied on the very next commit without a cascading re-render.
 *
 * Every read and write is guarded — a browser with site data blocked throws on
 * access, and the UI has to keep working.
 */
const cache = new Map<string, string | null>();
const listeners = new Map<string, Set<() => void>>();

function read(key: string): string | null {
  if (!cache.has(key)) {
    try {
      cache.set(key, window.localStorage.getItem(key));
    } catch {
      cache.set(key, null);
    }
  }
  return cache.get(key) ?? null;
}

export function writePersisted(key: string, value: string): void {
  cache.set(key, value);
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // preference is kept in memory for this session only
  }
  listeners.get(key)?.forEach((l) => l());
}

function subscribe(key: string, listener: () => void): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(listener);

  // another tab changing the same preference should be reflected here
  const onStorage = (e: StorageEvent) => {
    if (e.key === key) {
      cache.delete(key);
      listener();
    }
  };
  window.addEventListener("storage", onStorage);

  return () => {
    set.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** The raw stored string, or null on the server and before it is set. */
export function usePersisted(key: string): string | null {
  const sub = useCallback((l: () => void) => subscribe(key, l), [key]);
  return useSyncExternalStore(
    sub,
    () => read(key),
    () => null,
  );
}

/** A persisted boolean, defaulting to `fallback` until one is stored. */
export function usePersistedFlag(key: string, fallback = false): [boolean, (v: boolean) => void] {
  const raw = usePersisted(key);
  const value = raw === null ? fallback : raw === "1";
  return [value, (v: boolean) => writePersisted(key, v ? "1" : "0")];
}

/** A persisted JSON record, merged over `fallback`. */
export function usePersistedRecord<T>(
  key: string,
  fallback: Record<string, T>,
): [Record<string, T>, (next: Record<string, T>) => void] {
  const raw = usePersisted(key);
  let stored: Record<string, T> = {};
  if (raw) {
    try {
      stored = JSON.parse(raw) as Record<string, T>;
    } catch {
      stored = {};
    }
  }
  return [{ ...fallback, ...stored }, (next) => writePersisted(key, JSON.stringify(next))];
}
