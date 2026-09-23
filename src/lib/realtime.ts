import "server-only";

import { Client } from "pg";

/**
 * Live notification fan-out.
 *
 * One LISTEN connection per server process — not one per browser tab — hears
 * the "bela_notifications" channel that a trigger on the notification table
 * announces to (migration 0015). Each open tab registers a callback for its
 * own user id; an announcement wakes only that user's tabs, which then fetch
 * their summary through the ordinary, permission-checked action.
 *
 * The payload is just a user id, so nothing sensitive crosses the channel.
 * If the connection drops, it reconnects with backoff and tells every tab to
 * refresh, so a notification written during the gap is not missed.
 */

type Listener = () => void;

const CHANNEL = "bela_notifications";

type State = {
  client: Client | null;
  connecting: Promise<void> | null;
  listeners: Map<string, Set<Listener>>;
  retry: number;
};

const g = globalThis as unknown as { __belaRealtime?: State };
const state: State = (g.__belaRealtime ??= { client: null, connecting: null, listeners: new Map(), retry: 0 });

function wakeAll() {
  for (const set of state.listeners.values()) for (const fn of set) fn();
}

async function connect(): Promise<void> {
  if (state.client || state.connecting) return state.connecting ?? undefined;
  state.connecting = (async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL, application_name: "bela-hrms:realtime", keepAlive: true });
    try {
      await client.connect();
      await client.query(`LISTEN ${CHANNEL}`);
      client.on("notification", (msg) => {
        if (msg.channel !== CHANNEL || !msg.payload) return;
        for (const fn of state.listeners.get(msg.payload) ?? []) fn();
      });
      const drop = (error?: Error) => {
        if (state.client !== client) return;
        if (error) console.error("[realtime] listener lost:", error.message);
        state.client = null;
        client.end().catch(() => {});
        schedule();
      };
      client.on("error", drop);
      client.on("end", () => drop());
      state.client = client;
      if (state.retry) wakeAll(); // anything written while we were away
      state.retry = 0;
    } catch (error) {
      console.error("[realtime] could not listen:", (error as Error).message);
      client.end().catch(() => {});
      schedule();
    } finally {
      state.connecting = null;
    }
  })();
  return state.connecting;
}

function schedule() {
  if (state.listeners.size === 0) return;
  const delay = Math.min(30_000, 1_000 * 2 ** state.retry++);
  setTimeout(() => void connect(), delay).unref?.();
}

/** Calls `fn` whenever `userId`'s notifications change. Returns the unsubscribe. */
export function onNotificationsChanged(userId: string, fn: Listener): () => void {
  let set = state.listeners.get(userId);
  if (!set) state.listeners.set(userId, (set = new Set()));
  set.add(fn);
  void connect();
  return () => {
    set.delete(fn);
    if (set.size === 0) state.listeners.delete(userId);
    // the last tab closed: release the connection
    if (state.listeners.size === 0 && state.client) {
      const c = state.client;
      state.client = null;
      c.end().catch(() => {});
    }
  };
}
