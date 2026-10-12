import { TextLink } from "@/components/ui/button";
import { PlatformList, SeverityMark, StatusMark, platformName } from "@/components/ui/marks";
import { formatDay } from "@/lib/domain/format";
import type { DashboardChange } from "@/lib/queries/dashboard";

function Kind({ change }: { change: DashboardChange }) {
  switch (change.kind) {
    case "new":
      return <span className="font-medium text-ink">New wrong answer</span>;
    case "resolved":
      return <StatusMark status="resolved" className="font-medium" />;
    case "reopened":
      return <StatusMark status="reopened" className="font-medium" />;
    case "score":
      return <span className="font-medium text-ink">{platformName(change.platform)}</span>;
  }
}

function What({ change }: { change: DashboardChange }) {
  if (change.kind === "score") {
    const up = change.delta > 0;
    return (
      <p className="text-ink">
        <span aria-hidden="true" className="mr-1.5">
          {up ? "↑" : "↓"}
        </span>
        Accuracy Score {up ? "up" : "down"} {Math.abs(change.delta)}, from {Math.round(change.from)} to {Math.round(change.to)}
      </p>
    );
  }
  const { issue } = change;
  return (
    <>
      <TextLink href={`/app/issues/${issue.number}`} className="text-ink">
        {issue.title}
      </TextLink>
      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-graphite">
        <SeverityMark severity={issue.severity} />
        <span aria-hidden="true">·</span>
        <PlatformList platforms={issue.platforms} />
        {change.kind === "reopened" ? (
          <>
            <span aria-hidden="true">·</span>
            <span>The error came back after it was resolved</span>
          </>
        ) : null}
      </p>
    </>
  );
}

/** A dated list of new, resolved and reopened issues and score movement per platform. */
export function ChangeList({ changes }: { changes: DashboardChange[] }) {
  return (
    <ol className="border-t border-rule">
      {changes.map((change) => (
        <li
          key={change.kind === "score" ? `score-${change.platform}` : `${change.kind}-${change.issue.number}`}
          className="grid gap-x-6 gap-y-1 border-b border-rule py-3.5 sm:grid-cols-[4.5rem_11rem_minmax(0,1fr)]"
        >
          <p className="flex items-baseline gap-3 text-sm sm:contents">
            <time dateTime={change.at.toISOString()} className="text-graphite sm:pt-px">
              {formatDay(change.at)}
            </time>
            <span className="sm:text-base">
              <Kind change={change} />
            </span>
          </p>
          <div className="min-w-0">
            <What change={change} />
          </div>
        </li>
      ))}
    </ol>
  );
}
