/**
 * A small read-through cache for data that is read on every request and
 * changed rarely: who a login is and what it may do, an organisation's
 * dropdown masters, its current fiscal year, its notification rules.
 *
 * Why in-process and not Next's data cache or Redis: the product deploys as one
 * application container (see DEPLOYMENT.md), so the process *is* the shared
 * state, and a cache in it needs no network hop, no serialisation — Sets and
 * Dates survive — and no second service to run. The price is that a write made
 * by another process (the `admin:unlock` console script) is seen only when the
 * entry's TTL runs out, which is why every TTL here is short. Scaling to more
 * than one app container means swapping this file for a shared store; nothing
 * outside it knows the difference.
 *
 * Three properties make it safe to put authorisation data in it:
 *
 *   Tags      — every entry carries tags; a write calls `invalidate(tag)` and
 *               every entry with that tag is gone before the write returns.
 *   Versions  — a load that *started* before an invalidation must not store
 *               its result after it. Each tag has a generation number; a load
 *               remembers the generations it began under and discards its result
 *               if any moved. Without this, "disable login" racing a page load
 *               could re-cache the enabled account for a full TTL.
 *   Coalesce  — concurrent misses for one key share a single load, so a burst
 *               of requests after an invalidation is one query, not fifty.
 *
 * Values are shared between requests. Treat what comes back as read-only.
 */

type Entry = { value: unknown; expires: number; tags: readonly string[] };

type Store = {
  entries: Map<string, Entry>;
  inflight: Map<string, { promise: Promise<unknown>; tags: readonly string[]; token: object }>;
  generations: Map<string, number>;
  hits: number;
  misses: number;
};

/** Upper bound on entries; the least recently used go first. */
const MAX_ENTRIES = 5000;

const g = globalThis as unknown as { __belaCache?: Store };
const store: Store = (g.__belaCache ??= {
  entries: new Map(),
  inflight: new Map(),
  generations: new Map(),
  hits: 0,
  misses: 0,
});

const generation = (tag: string) => store.generations.get(tag) ?? 0;

export type CacheOptions = {
  /** Seconds before the entry is reloaded regardless of invalidation. */
  ttl: number;
  tags?: readonly string[];
};

/**
 * Returns the cached value for `key`, loading it with `load` on a miss.
 *
 * A load that throws is not cached; the next caller tries again.
 */
export async function cached<T>(key: string, load: () => Promise<T>, options: CacheOptions): Promise<T> {
  // Tests and the check scripts want the database, not a memory of it.
  if (process.env.BELA_CACHE === "off") return load();

  const now = Date.now();
  const hit = store.entries.get(key);
  if (hit && hit.expires > now) {
    // refresh recency: Map iteration order is insertion order, so re-inserting
    // moves the key to the young end
    store.entries.delete(key);
    store.entries.set(key, hit);
    store.hits++;
    return hit.value as T;
  }

  const pending = store.inflight.get(key);
  if (pending) return pending.promise as Promise<T>;

  store.misses++;
  const tags = options.tags ?? [];
  const startedAt = tags.map(generation);
  // identifies this load, so its cleanup cannot remove a newer one for the key
  const token = {};

  const run = (async () => {
    try {
      const value = await load();
      const stale = tags.some((tag, i) => generation(tag) !== startedAt[i]);
      if (!stale) {
        store.entries.set(key, { value, expires: Date.now() + options.ttl * 1000, tags });
        while (store.entries.size > MAX_ENTRIES) {
          const oldest = store.entries.keys().next().value;
          if (oldest === undefined) break;
          store.entries.delete(oldest);
        }
      }
      return value;
    } finally {
      if (store.inflight.get(key)?.token === token) store.inflight.delete(key);
    }
  })();

  store.inflight.set(key, { promise: run, tags, token });
  return run;
}

/**
 * Drops every entry carrying any of these tags, and fences loads already in
 * flight so they cannot write the old value back.
 */
export function invalidate(...tags: string[]): void {
  if (tags.length === 0) return;
  const wanted = new Set(tags);
  for (const tag of wanted) store.generations.set(tag, generation(tag) + 1);
  for (const [key, entry] of store.entries) {
    if (entry.tags.some((t) => wanted.has(t))) store.entries.delete(key);
  }
  // A load in flight under one of these tags will be discarded when it lands;
  // forgetting it here also stops new callers from joining it.
  for (const [key, flight] of store.inflight) {
    if (flight.tags.some((t) => wanted.has(t))) store.inflight.delete(key);
  }
}

/** For the Modules screen: how well the cache is doing. */
export function cacheStats() {
  const total = store.hits + store.misses;
  return {
    entries: store.entries.size,
    hits: store.hits,
    misses: store.misses,
    hitRate: total ? store.hits / total : 0,
  };
}

/** The tag vocabulary, in one place so a writer and a reader cannot disagree. */
export const cacheTags = {
  /** Anything about logins, roles and grants, everywhere. */
  authz: "authz",
  user: (userId: string) => `authz:user:${userId}`,
  org: (orgId: string) => `org:${orgId}`,
  masters: (orgId: string) => `org:${orgId}:masters`,
  people: (orgId: string) => `org:${orgId}:people`,
  fiscalYear: (orgId: string) => `org:${orgId}:fy`,
  moduleStates: (orgId: string) => `org:${orgId}:modules`,
  notificationRules: (orgId: string) => `org:${orgId}:notify-rules`,
};
