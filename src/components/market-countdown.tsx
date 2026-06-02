import { memo, useEffect, useState } from "react";

type MarketCountdownProps = {
  closes_at: string | null;
  className?: string;
  onClosed?: () => void;
};

function getRemainingSeconds(closesAt: string | null) {
  if (!closesAt) return 0;

  const target = new Date(closesAt).getTime();
  if (!Number.isFinite(target)) return 0;

  return Math.max(0, Math.ceil((target - Date.now()) / 1_000));
}

function formatRemainingTime(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds]
    .map((unit) => unit.toString().padStart(2, "0"))
    .join(":");
}

export const MarketCountdown = memo(function MarketCountdown({
  closes_at,
  className = "",
  onClosed,
}: MarketCountdownProps) {
  const [remainingSeconds, setRemainingSeconds] = useState(() =>
    getRemainingSeconds(closes_at),
  );

  useEffect(() => {
    setRemainingSeconds(getRemainingSeconds(closes_at));

    const id = window.setInterval(() => {
      const next = getRemainingSeconds(closes_at);

      setRemainingSeconds((current) => {
        if (current === next) return current;
        if (next <= 0 && current > 0) onClosed?.();
        return next;
      });
    }, 1_000);

    return () => window.clearInterval(id);
  }, [closes_at, onClosed]);

  const isClosed = remainingSeconds <= 0;
  const isUrgent = remainingSeconds > 0 && remainingSeconds < 60;
  const label = isClosed ? "CLOSED" : `closes in ${formatRemainingTime(remainingSeconds)}`;

  return (
    <span
      className={[
        "market-countdown inline-flex items-center rounded-md px-3 py-2 font-mono text-sm font-semibold uppercase tracking-wider tabular-nums transition-colors duration-300",
        isClosed
          ? "bg-foreground/5 text-foreground/40"
          : isUrgent
            ? "market-countdown-urgent bg-red-500/10 text-red-600"
            : "bg-muted/40 text-foreground/70",
        className,
      ].join(" ")}
    >
      <span>{label}</span>
    </span>
  );
});
