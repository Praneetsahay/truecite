import type { ReactNode } from "react";
import { Notice } from "@/components/ui/page";
import type { ReviewState } from "@/lib/domain/constants";

/** The message after a review decision, shown on the next item or back on the queue. */
export function ReviewedNotice({
  summary,
  children,
  className,
}: {
  summary: {
    number: number;
    title: string;
    reviewState: ReviewState;
    organizationName: string;
    brandName: string;
    internal: boolean;
  };
  children?: ReactNode;
  className?: string;
}) {
  const client = summary.internal ? `the ${summary.brandName} prospect report` : summary.organizationName;
  const approved = summary.reviewState === "approved";
  const title = `${approved ? "Approved" : summary.reviewState === "rejected" ? "Rejected" : "Saved"}: #${summary.number} ${summary.title}`;
  const outcome = approved
    ? summary.internal
      ? `It can go into ${client}.`
      : `${client} can see it now. Their alert rules decide who hears about it.`
    : summary.internal
      ? `It stays out of ${client}. Your note is kept for the checker.`
      : `${client} will not see it. Your note is kept for the checker.`;

  return (
    <Notice tone="done" title={title} className={className}>
      {outcome}
      {children ? <> {children}</> : null}
    </Notice>
  );
}
