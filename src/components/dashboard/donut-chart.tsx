export type DonutSegment = {
  label: string;
  value: number;
  color?: string;
};

const PALETTE = [
  "#0284c7",
  "#7c3aed",
  "#d97706",
  "#059669",
  "#64748b",
  "#dc2626",
  "#0891b2",
  "#db2777",
];

const SIZE = 160;
const STROKE = 20;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * Dependency-free SVG donut chart. Segment arcs are derived from the same
 * database counts that are displayed in the legend, so the chart can never
 * drift from the underlying records.
 */
export function DonutChart({
  segments,
  centerLabel = "Total",
}: {
  segments: DonutSegment[];
  centerLabel?: string;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const visible = segments.filter((segment) => segment.value > 0);

  let offset = 0;
  const originalIndex = new Map(
    segments.map((segment, index) => [segment, index])
  );

  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row sm:justify-center">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        width={SIZE}
        height={SIZE}
        role="img"
        aria-label={`${centerLabel}: ${total}`}
      >
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="#e2e8f0"
          strokeWidth={STROKE}
        />
        {visible.map((segment, drawIndex) => {
          const index = originalIndex.get(segment) ?? 0;
          const length = (segment.value / total) * CIRCUMFERENCE;
          const circle = (
            <circle
              key={segment.label}
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke={segment.color ?? PALETTE[index % PALETTE.length]}
              strokeWidth={STROKE}
              strokeDasharray={`${length} ${CIRCUMFERENCE - length}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
              className="donut-segment"
              style={
                {
                  "--len": `${length}px`,
                  "--circ": `${CIRCUMFERENCE}px`,
                  animationDelay: `${drawIndex * 140}ms`,
                } as React.CSSProperties
              }
            />
          );
          offset += length;
          return circle;
        })}
        <text
          x="50%"
          y="47%"
          textAnchor="middle"
          dominantBaseline="middle"
          className="fill-slate-900 text-2xl font-bold"
        >
          {total}
        </text>
        <text
          x="50%"
          y="60%"
          textAnchor="middle"
          dominantBaseline="middle"
          className="fill-slate-500 text-[10px] font-semibold uppercase tracking-wide"
        >
          {centerLabel}
        </text>
      </svg>

      <ul className="space-y-2 text-sm">
        {segments.map((segment, index) => (
          <li key={segment.label} className="flex items-center gap-2">
            <span
              className="inline-block h-3 w-3 rounded-sm"
              style={{
                backgroundColor: segment.color ?? PALETTE[index % PALETTE.length],
              }}
            />
            <span className="text-slate-700">{segment.label}</span>
            <span className="ml-auto font-semibold text-slate-900">
              {segment.value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
