import { StatusMark } from "@/components/ui/marks";
import type { IssueEvent } from "@/lib/db";
import { ISSUE_STATUSES, SYSTEM_ACTOR, type IssueStatus } from "@/lib/domain/constants";
import { formatDateTime } from "@/lib/domain/format";

/*
  The evidence trail: every change to the issue, oldest first, with the date,
  the time and who made it. Styled as an audit log, not a feed.
*/

type Entry = { what: string; note: string | null; status: IssueStatus | null };

const lower = (status: IssueStatus) => ISSUE_STATUSES[status].label.toLowerCase();

function describe(event: IssueEvent): Entry {
  const note = event.note?.trim() || null;
  switch (event.kind) {
    case "detected":
      return { what: "Found by TrueCite in a scan", note, status: event.toStatus };
    case "approved":
      return { what: "Confirmed in TrueCite review and shared with your team", note, status: null };
    case "rejected":
      return { what: "Rejected in TrueCite review", note, status: null };
    case "status":
      return {
        what:
          event.fromStatus && event.toStatus
            ? `Moved from ${lower(event.fromStatus)} to ${lower(event.toStatus)}`
            : event.toStatus
              ? `Moved to ${lower(event.toStatus)}`
              : "Changed the status",
        note,
        status: event.toStatus,
      };
    case "assigned":
      // The note carries who was assigned, such as "Assigned to Karan Shah".
      return { what: note ?? "Changed the assignee", note: null, status: null };
    case "note":
      return { what: "Added a note", note, status: null };
    case "seen":
      return { what: "Seen again in a scan", note, status: null };
    case "clean":
      return { what: "Re-checked: answers were correct", note, status: null };
    case "recheck":
      return { what: "Started a re-check", note, status: null };
    case "not_an_error":
      return { what: "Marked as not an error", note, status: null };
    case "reopened":
      return { what: "Reopened: the error came back", note, status: "reopened" };
    case "resolved":
      return { what: "Resolved: answers were correct for two scans in a row", note, status: "resolved" };
    case "severity":
      return { what: "Changed the severity", note, status: null };
    case "fix_step": {
      const done = note?.match(/^Done:\s*([\s\S]+)$/);
      const undone = note?.match(/^Not done:\s*([\s\S]+)$/);
      if (done) return { what: "Ticked a fix step", note: done[1], status: null };
      if (undone) return { what: "Unticked a fix step", note: undone[1], status: null };
      return { what: "Updated the fix steps", note, status: null };
    }
  }
}

export function IssueHistory({ events }: { events: IssueEvent[] }) {
  if (events.length === 0) {
    return <p className="border-t border-rule py-4 text-graphite">Nothing recorded yet.</p>;
  }
  return (
    <ol className="border-t border-rule">
      {events.map((event) => {
        const entry = describe(event);
        const actor = event.actorId ? event.actorName : event.actorName || SYSTEM_ACTOR;
        return (
          <li key={event.id} className="grid gap-1 border-b border-rule py-4 sm:grid-cols-[9.5rem_minmax(0,1fr)] sm:gap-6">
            <time dateTime={event.createdAt.toISOString()} className="pt-px text-sm text-graphite">
              {formatDateTime(event.createdAt)}
            </time>
            <div className="min-w-0">
              <p className="text-ink">{entry.what}</p>
              {entry.note ? (
                <p className="mt-1 max-w-prose break-words whitespace-pre-line text-ink/85">{entry.note}</p>
              ) : null}
              <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-graphite">
                <span>{actor}</span>
                {entry.status ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <StatusMark status={entry.status} />
                  </>
                ) : null}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
