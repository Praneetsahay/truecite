import Link from "next/link";
import { platformName } from "@/components/ui/marks";
import { RowHead, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { listJoin } from "@/lib/domain/format";
import type { QuestionResult, QuestionRow } from "@/lib/queries/content";
import { cx } from "@/lib/cx";
import type { ContentAction } from "./form-state";
import { ActiveSwitch, PrioritySwitch } from "./question-controls";

const quietLink = "underline decoration-rule-strong underline-offset-[3px] hover:decoration-ink";

/** What the latest scan found, in words first and color second. */
export function QuestionResultText({ result, className }: { result: QuestionResult; className?: string }) {
  if (result.kind === "unchecked") return <span className={cx("text-graphite", className)}>Not checked yet</span>;

  if (result.kind === "wrong") {
    const [first, ...more] = result.issues;
    const text = `Wrong on ${listJoin(result.wrongOn.map(platformName))}`;
    return (
      <span className={cx("inline-flex flex-wrap items-baseline gap-x-2", className)}>
        {first ? (
          <Link href={`/app/issues/${first.number}`} className={cx("text-correction", quietLink, "decoration-correction/40 hover:decoration-correction")}>
            {text}
            <span className="sr-only">, issue {first.number}</span>
          </Link>
        ) : (
          <span className="text-correction">{text}</span>
        )}
        {more.length > 0 ? (
          <span className="text-sm text-graphite">
            also {more.length === 1 ? "issue" : "issues"}{" "}
            {more.map((issue, index) => (
              <span key={issue.number}>
                {index === 0 ? null : index === more.length - 1 ? " and " : ", "}
                <Link href={`/app/issues/${issue.number}`} className={cx("figures", quietLink)}>
                  {issue.number}
                  <span className="sr-only">: {issue.status === "resolved" ? "resolved" : "open"}</span>
                </Link>
              </span>
            ))}
          </span>
        ) : null}
      </span>
    );
  }

  if (result.kind === "mixed") {
    return (
      <span className={className}>
        <span className="highlight text-ink">Mixed</span>
        <span className="text-graphite"> on {listJoin(result.mixedOn.map(platformName))}</span>
      </span>
    );
  }

  const n = result.platforms.length;
  const where = n >= 3 ? `all ${n}` : listJoin(result.platforms.map(platformName));
  return <span className={cx("text-verified", className)}>Correct on {where}</span>;
}

export function QuestionTable({
  rows,
  caption,
  canEdit,
  savedId,
  activeAction,
  priorityAction,
  returnTo,
}: {
  rows: QuestionRow[];
  caption: string;
  canEdit: boolean;
  savedId?: string;
  activeAction: ContentAction;
  priorityAction: ContentAction;
  /** Set when switched-off questions are hidden, so switching one off says where it went. */
  returnTo?: string;
}) {
  return (
    <Table caption={caption}>
      <THead>
        <TR>
          <TH className="pr-4">Question</TH>
          <TH className="hidden w-40 pr-4 md:table-cell">Priority</TH>
          <TH className="hidden w-[22rem] pr-4 lg:table-cell">Latest result</TH>
          <TH className="w-24 pr-4">In scans</TH>
          {canEdit ? (
            <TH className="hidden w-10 sm:table-cell">
              <span className="sr-only">Edit</span>
            </TH>
          ) : null}
        </TR>
      </THead>
      <TBody>
        {rows.map((row) => (
          <TR key={row.id} id={`question-${row.id}`} className={cx("scroll-mt-24", row.id === savedId && "bg-wash")}>
            <RowHead className="pr-4 lg:min-w-[20rem]">
              <span className={row.active ? "text-ink" : "text-graphite"}>{row.text}</span>
              <span className={cx("mt-1 flex flex-wrap gap-x-2 text-sm text-graphite", row.origin !== "custom" && "md:hidden")}>
                <span className="md:hidden">{row.priority === "key" ? "Key question" : "Standard"}</span>
                {row.origin === "custom" ? (
                  <span>
                    <span aria-hidden="true" className="md:hidden">
                      ·{" "}
                    </span>
                    Added by your team
                  </span>
                ) : null}
              </span>
              <span className="mt-1 block text-sm lg:hidden">
                <QuestionResultText result={row.result} />
              </span>
            </RowHead>
            <TD className="hidden pr-4 md:table-cell">
              {canEdit ? (
                <PrioritySwitch action={priorityAction} id={row.id} priority={row.priority} question={row.text} />
              ) : (
                <span className={row.priority === "key" ? "text-ink" : "text-graphite"}>
                  {row.priority === "key" ? "Key" : "Standard"}
                </span>
              )}
            </TD>
            <TD className="hidden pr-4 lg:table-cell">
              <QuestionResultText result={row.result} />
            </TD>
            <TD className="pr-4">
              {canEdit ? (
                <>
                  <ActiveSwitch action={activeAction} id={row.id} active={row.active} question={row.text} returnTo={returnTo} />
                  <Link href={`/app/questions/${row.id}/edit`} className={cx("mt-2 inline-block text-sm text-ink sm:hidden", quietLink)}>
                    Edit<span className="sr-only">: {row.text}</span>
                  </Link>
                </>
              ) : (
                <span className={row.active ? "text-ink" : "text-graphite"}>{row.active ? "On" : "Off"}</span>
              )}
            </TD>
            {canEdit ? (
              <TD className="hidden w-0 text-sm sm:table-cell">
                <Link href={`/app/questions/${row.id}/edit`} className={cx("text-ink", quietLink)}>
                  Edit<span className="sr-only">: {row.text}</span>
                </Link>
              </TD>
            ) : null}
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
