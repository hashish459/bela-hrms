/** 135 → "2h 15m". Shared by the server page and the client panels. */
export function hm(m: number | null | undefined): string {
  if (!m) return "0h";
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}
