import { getViewer } from "@/lib/session";
import { onNotificationsChanged } from "@/lib/realtime";

export const dynamic = "force-dynamic";

/** Keeps proxies from closing an idle stream, and detects dead clients. */
const HEARTBEAT_MS = 25_000;
/** Browsers reconnect on their own; a bounded life keeps sessions re-checked. */
const MAX_LIFE_MS = 30 * 60_000;

/**
 * Server-sent events for the signed-in user's notifications.
 *
 * Sends `changed` whenever anything about their notifications changes — a new
 * one, a read in another tab — and nothing else: the tab then asks for its
 * summary through the normal action, so the stream never carries content and
 * cannot leak another person's notifications.
 */
export async function GET(request: Request) {
  const viewer = await getViewer();
  if (!viewer) return new Response("Unauthorised", { status: 401 });

  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let pending: ReturnType<typeof setTimeout> | null = null;
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };

      // several rows in quick succession (an approval notifying three people,
      // a bulk read) arrive as one nudge
      const nudge = () => {
        if (pending) return;
        pending = setTimeout(() => {
          pending = null;
          send(`event: changed\ndata: ${Date.now()}\n\n`);
        }, 150);
      };

      const unsubscribe = onNotificationsChanged(viewer.userId, nudge);
      const beat = setInterval(() => send(`: keep-alive\n\n`), HEARTBEAT_MS);
      const life = setTimeout(() => cleanup(), MAX_LIFE_MS);

      cleanup = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        clearInterval(beat);
        clearTimeout(life);
        if (pending) clearTimeout(pending);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      request.signal.addEventListener("abort", cleanup);

      send(`retry: 5000\nevent: ready\ndata: ok\n\n`);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
