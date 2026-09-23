/**
 * A balance as a ring: the coloured arc is what is left, the amber arc what is
 * held by requests still waiting, the grey track what has been used. Pure SVG,
 * so it renders on the server and costs nothing to hydrate.
 */
export function BalanceRing({
  available,
  pending,
  entitled,
  colour,
  size = 76,
}: {
  available: number;
  pending: number;
  entitled: number;
  colour: string;
  size?: number;
}) {
  const stroke = 7;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const total = entitled > 0 ? entitled : 1;
  const left = Math.max(0, Math.min(1, available / total));
  const held = Math.max(0, Math.min(1 - left, pending / total));

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 -rotate-90" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-sunk)" strokeWidth={stroke} />
      {held > 0 ? (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-warn)"
          strokeWidth={stroke}
          strokeDasharray={`${held * c} ${c}`}
          strokeDashoffset={-left * c}
          strokeLinecap="round"
        />
      ) : null}
      {left > 0 ? (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={colour}
          strokeWidth={stroke}
          strokeDasharray={`${left * c} ${c}`}
          strokeLinecap="round"
        />
      ) : null}
    </svg>
  );
}
