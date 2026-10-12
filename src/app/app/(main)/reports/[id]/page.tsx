import type { Metadata } from "next";
import Link from "next/link";
import { ActionButton } from "@/components/account/action-button";
import { CopyField } from "@/components/account/copy-field";
import { ReportSheet } from "@/components/account/report-sheet";
import { ReportDocument } from "@/components/report/report-document";
import { buttonClass } from "@/components/ui/button";
import { requireClient } from "@/lib/auth/dal";
import { formatDate } from "@/lib/domain/format";
import { appOrigin, getReportForClient, shareStatus } from "@/lib/queries/account";
import { stopSharingReport } from "../actions";
import { ShareButton } from "./share-button";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const ctx = await requireClient();
  const report = await getReportForClient(ctx, id);
  return { title: report.title };
}

export default async function ReportPage({ params }: Props) {
  const { id } = await params;
  const ctx = await requireClient();
  const report = await getReportForClient(ctx, id);
  const status = shareStatus(report, ctx.now);
  const shareUrl = status.state === "active" && report.shareToken ? `${await appOrigin()}/r/${report.shareToken}` : null;

  return (
    <>
      <div className="flex flex-col gap-4 pb-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <nav aria-label="Breadcrumb" className="text-sm text-graphite">
            <ol className="flex flex-wrap items-center gap-1.5">
              <li className="flex items-center gap-1.5">
                <Link href="/app/reports" className="hover:text-ink hover:underline hover:underline-offset-[3px]">
                  Reports
                </Link>
              </li>
              <li className="flex min-w-0 items-center gap-1.5">
                <span aria-hidden="true">/</span>
                <span aria-current="page">{report.title}</span>
              </li>
            </ol>
          </nav>
          {status.state === "active" && !ctx.canEdit ? (
            <p className="mt-1 text-sm text-graphite">
              Shared by private link{status.expiresAt ? ` until ${formatDate(status.expiresAt)}` : ""}.
            </p>
          ) : null}
          {status.state === "expired" && ctx.canEdit ? (
            <p className="mt-1 text-sm text-graphite">The last share link expired on {formatDate(status.expiresAt)}.</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-start gap-3">
          {/* A plain link: the PDF is a file download, not a page to prefetch. */}
          <a href={`/app/reports/${report.id}/pdf`} className={buttonClass("primary")}>
            Download PDF
          </a>
          {ctx.canEdit && status.state !== "active" ? <ShareButton reportId={report.id} /> : null}
        </div>
      </div>

      {shareUrl && ctx.canEdit ? (
        <section aria-labelledby="share-title" className="mb-8 border-t border-rule pt-5">
          <h2 id="share-title" className="text-base font-semibold text-ink">
            Share link
          </h2>
          <p className="mt-0.5 text-sm text-graphite">
            Anyone with this link can read the report without logging in
            {status.state === "active" && status.expiresAt ? `, until ${formatDate(status.expiresAt)}` : ""}. Search
            engines do not index it.
          </p>
          <div className="mt-4 grid max-w-2xl gap-3">
            <CopyField id="share-url" label="Private link" value={shareUrl} />
            <ActionButton
              action={stopSharingReport}
              fields={{ id: report.id }}
              label="Turn off link"
              confirm={{ question: "Turn off this link now? People who open it will see that it has expired.", confirmLabel: "Turn off" }}
            />
          </div>
        </section>
      ) : null}

      <ReportSheet>
        <ReportDocument data={report.data} />
      </ReportSheet>
    </>
  );
}

export const instant = false;
