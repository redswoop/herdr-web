/** Inline-SVG sparkline over [[t, v]] samples. No axes, no library: it is a
 *  polyline that fills its box and a faint area under it. `floor` pins the
 *  bottom (0 for percentages) so a flat line reads as flat. */
export function Sparkline({
  points,
  floor,
  ceil,
  height = 26,
  className,
}: {
  points: [number, number][];
  floor?: number;
  ceil?: number;
  height?: number;
  className?: string;
}) {
  if (points.length < 2) return <svg className={`sspark ${className ?? ''}`} viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" height={height} />;
  const t0 = points[0][0];
  const t1 = points[points.length - 1][0];
  const vs = points.map((p) => p[1]);
  const lo = floor ?? Math.min(...vs);
  const hi = Math.max(ceil ?? Math.max(...vs), lo + 1e-9);
  const span = Math.max(t1 - t0, 1);
  const xy = points.map(([t, v]) => {
    const x = ((t - t0) / span) * 100;
    const y = height - 2 - ((v - lo) / (hi - lo)) * (height - 4);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const line = xy.join(' ');
  const area = `0,${height} ${line} 100,${height}`;
  return (
    <svg className={`sspark ${className ?? ''}`} viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" height={height} aria-hidden="true">
      <polygon className="sspark-area" points={area} />
      <polyline className="sspark-line" points={line} />
    </svg>
  );
}
