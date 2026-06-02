type MarketLiquidityBarProps = {
  yes_points: number;
  no_points: number;
  className?: string;
};

function formatPoints(points: number) {
  return Math.max(0, points).toLocaleString("en-US");
}

export function MarketLiquidityBar({
  yes_points,
  no_points,
  className = "",
}: MarketLiquidityBarProps) {
  const yesPoints = Math.max(0, yes_points);
  const noPoints = Math.max(0, no_points);
  const total = yesPoints + noPoints;

  const yesPercentage = total > 0 ? (yesPoints / total) * 100 : 0;
  const noPercentage = total > 0 ? 100 - yesPercentage : 0;

  return (
    <div className={["space-y-2", className].join(" ")}>
      <div className="flex items-center justify-between gap-3 font-mono text-xs font-semibold uppercase tracking-wider text-foreground/55">
        <span>
          YES: {formatPoints(yesPoints)} pts
          {total > 0 ? ` · ${Math.round(yesPercentage)}%` : ""}
        </span>
        <span>
          NO: {formatPoints(noPoints)} pts
          {total > 0 ? ` · ${Math.round(noPercentage)}%` : ""}
        </span>
      </div>

      <div className="h-3 overflow-hidden rounded-full bg-foreground/10">
        {total === 0 ? (
          <div className="h-full w-full bg-foreground/10" />
        ) : (
          <div className="flex h-full w-full">
            <div
              className="h-full bg-green-600 transition-[width] duration-500 ease-out"
              style={{ width: `${yesPercentage}%` }}
            />
            <div
              className="h-full bg-red-600 transition-[width] duration-500 ease-out"
              style={{ width: `${noPercentage}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
