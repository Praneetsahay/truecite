import Link from "next/link";
import { PLATFORMS } from "@/lib/domain/constants";
import { cx } from "@/lib/cx";
import { formatDate } from "@/lib/domain/format";
import type { PlatformSighting } from "@/lib/queries/issues";

export function seenInRuns(sighting: Pick<PlatformSighting, "runsSeen" | "runsTotal">): string | null {
  if (sighting.runsSeen === null || sighting.runsTotal === null || sighting.runsTotal === 0) return null;
  return `Seen in ${sighting.runsSeen} of ${sighting.runsTotal} runs`;
}

/** One link per AI platform that gave the wrong answer. The answer below follows the current one. */
export function PlatformTabs({
  number,
  sightings,
  current,
}: {
  number: number;
  sightings: PlatformSighting[];
  current: PlatformSighting["platform"];
}) {
  return (
    <nav aria-label="Answers by AI platform" className="-mx-1 overflow-x-auto">
      <ul className="flex min-w-max items-end gap-1 border-b border-rule">
        {sightings.map((sighting) => {
          const active = sighting.platform === current;
          const runs = seenInRuns(sighting);
          return (
            <li key={sighting.platform}>
              <Link
                href={`/app/issues/${number}?platform=${sighting.platform}`}
                scroll={false}
                aria-current={active ? "true" : undefined}
                className={cx(
                  "mx-1 -mb-px flex flex-col border-b-2 px-1 pt-1 pb-2.5 transition-colors",
                  active ? "border-ink" : "border-transparent hover:border-rule-strong",
                )}
              >
                <span className={cx("text-base", active ? "font-medium text-ink" : "text-graphite")}>
                  {PLATFORMS[sighting.platform].name}
                </span>
                <span className="text-sm text-graphite">
                  {runs ?? (sighting.cleanAt ? `Not seen on ${formatDate(sighting.cleanAt)}` : "No answer stored")}
</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
