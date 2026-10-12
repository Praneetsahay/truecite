import { cx } from "@/lib/cx";

/** The key for SentimentBar: solid, light and hatched, so color is not the only signal. */
export function SentimentLegend({ className }: { className?: string }) {
  const items = [
    { label: "Positive", swatch: "bg-ink" },
    { label: "Neutral", swatch: "bg-graphite/35" },
    { label: "Negative", swatch: "bg-[repeating-linear-gradient(135deg,var(--color-graphite)_0_2px,transparent_2px_4px)]" },
  ];
  return (
    <p className={cx("flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-graphite", className)}>
      <span className="sr-only">Sentiment key:</span>
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-2">
          <span aria-hidden="true" className={cx("inline-block h-1.5 w-4 rounded-xs", item.swatch)} />
          {item.label}
        </span>
      ))}
    </p>
  );
}

/** "46% positive, 13% negative", for the sentiment column. */
export function sentimentSummary(split: { positive: number; neutral: number; negative: number }): string {
  const total = split.positive + split.neutral + split.negative || 1;
  const pct = (n: number) => Math.round((n / total) * 100);
  return `${pct(split.positive)}% positive, ${pct(split.negative)}% negative`;
}
