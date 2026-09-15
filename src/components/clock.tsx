"use client";

import { useEffect, useState } from "react";

/**
 * Nepal Standard Time, ticking, to the second.
 *
 * Three things it deliberately does not do:
 *
 *   • It does not render a time on the server. A server-rendered clock is wrong
 *     by the length of the round trip and mismatches on hydration, so the first
 *     paint is a stable placeholder of the same width and the real value arrives
 *     on the first client tick.
 *   • It does not trust the browser's timezone. Attendance is recorded in NPT
 *     (UTC+05:45); a clerk in another timezone reading their own local time
 *     against a punch list would mis-read every row. `timeZone` pins it.
 *   • It does not reflow. Tabular figures and a fixed layout mean the header
 *     does not jitter once a second — the reason most in-app clocks get removed
 *     again a week after they are added.
 */
const NPT = "Asia/Kathmandu";

const FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: NPT,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export function Clock({ className }: { className?: string }) {
  // null until mounted: the placeholder occupies the same width, so nothing
  // shifts when the real time replaces it.
  const [time, setTime] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => setTime(FORMATTER.format(new Date()));
    tick();

    // Align to the next whole second so the display changes when the clock does,
    // rather than drifting by however long the mount took.
    let interval: ReturnType<typeof setInterval>;
    const align = setTimeout(
      () => {
        tick();
        interval = setInterval(tick, 1000);
      },
      1000 - (Date.now() % 1000),
    );

    return () => {
      clearTimeout(align);
      clearInterval(interval);
    };
  }, []);

  return (
    <time
      className={className}
      suppressHydrationWarning
      aria-label={time ? `Nepal time ${time}` : "Nepal time"}
    >
      {time ?? "--:--:--"}
    </time>
  );
}
