import Link from "next/link";
import { ExternalLink } from "@/components/ui/button";
import { SeverityMark } from "@/components/ui/marks";
import { RowHead, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { Fact } from "@/lib/db";
import { FACT_CATEGORIES } from "@/lib/domain/constants";
import { displayUrl, formatDate } from "@/lib/domain/format";
import { ActionButton } from "./action-button";
import type { ContentAction } from "./form-state";

/*
  The Fact Sheet's tables. Columns that do not fit a phone move into a line
  under the fact, so nothing scrolls sideways.
*/

const quietLink = "text-ink underline decoration-rule-strong underline-offset-[3px] hover:decoration-ink";

function Source({ fact }: { fact: Fact }) {
  if (fact.sourceUrl) {
    return (
      <ExternalLink href={fact.sourceUrl} className="break-words">
        {displayUrl(fact.sourceUrl)}
      </ExternalLink>
    );
  }
  return <span className="text-graphite">{fact.origin === "manual" ? "Added by your team" : "No page"}</span>;
}

/** Approved facts that are true today, in one category. */
export function CurrentFactTable({ facts, caption, canEdit }: { facts: Fact[]; caption: string; canEdit: boolean }) {
  return (
    <Table caption={caption}>
      <THead>
        <TR>
          <TH className="pr-4">Fact</TH>
          <TH className="hidden w-32 pr-4 md:table-cell">Importance</TH>
          <TH className="hidden w-32 pr-4 lg:table-cell">Valid from</TH>
          <TH className="hidden w-60 pr-4 lg:table-cell">Source</TH>
          <TH className="hidden w-32 pr-4 xl:table-cell">Last updated</TH>
          {canEdit ? (
            <TH className="hidden w-32 sm:table-cell">
              <span className="sr-only">Changes</span>
            </TH>
          ) : null}
        </TR>
      </THead>
      <TBody>
        {facts.map((fact) => (
          <TR key={fact.id} id={`fact-${fact.id}`} className="scroll-mt-24">
            <RowHead className="pr-4 md:min-w-[18rem]">
              <span className="text-ink">{fact.statement}</span>
              {fact.validTo ? (
                <span className="mt-1 block text-sm text-graphite">Valid until {formatDate(fact.validTo)}</span>
              ) : null}
              <span className="mt-1 block text-sm text-graphite lg:hidden">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="md:hidden">
                    <SeverityMark severity={fact.importance} />
                  </span>
                  {fact.validFrom ? (
                    <>
                      <span aria-hidden="true" className="md:hidden">·</span>
                      <span>From {formatDate(fact.validFrom)}</span>
                    </>
                  ) : null}
                </span>
                {fact.sourceUrl ? (
                  <span className="mt-0.5 block break-all">
                    <Source fact={fact} />
                  </span>
                ) : null}
              </span>
              {canEdit ? (
                <span className="mt-2 flex gap-4 text-sm sm:hidden">
                  <Link href={`/app/facts/${fact.id}/edit`} className={quietLink}>
                    Edit<span className="sr-only">: {fact.statement}</span>
                  </Link>
                  <Link href={`/app/facts/${fact.id}/edit#no-longer-true`} className={quietLink}>
                    No longer true<span className="sr-only">: {fact.statement}</span>
                  </Link>
                </span>
              ) : null}
            </RowHead>
            <TD className="hidden pr-4 whitespace-nowrap md:table-cell">
              <SeverityMark severity={fact.importance} />
            </TD>
            <TD className="hidden pr-4 whitespace-nowrap lg:table-cell">
              {fact.validFrom ? formatDate(fact.validFrom) : <span className="text-graphite">Not dated</span>}
            </TD>
            <TD className="hidden max-w-[16rem] pr-4 lg:table-cell">
              <Source fact={fact} />
            </TD>
            <TD className="hidden pr-4 whitespace-nowrap text-graphite xl:table-cell">{formatDate(fact.updatedAt)}</TD>
            {canEdit ? (
              <TD className="hidden whitespace-nowrap text-sm sm:table-cell">
                <span className="flex flex-col items-start gap-1.5">
                  <Link href={`/app/facts/${fact.id}/edit`} className={quietLink}>
                    Edit<span className="sr-only">: {fact.statement}</span>
                  </Link>
                  <Link href={`/app/facts/${fact.id}/edit#no-longer-true`} className={quietLink}>
                    No longer true<span className="sr-only">: {fact.statement}</span>
                  </Link>
                </span>
              </TD>
            ) : null}
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

/** Facts TrueCite drafted from the website, waiting for the team. */
export function DraftFactTable({
  facts,
  canEdit,
  approveAction,
  deleteAction,
}: {
  facts: Fact[];
  canEdit: boolean;
  approveAction: ContentAction;
  deleteAction: ContentAction;
}) {
  return (
    <Table caption="Draft facts waiting for approval">
      <THead>
        <TR>
          <TH className="pr-4">Draft fact</TH>
          <TH className="hidden pr-4 md:table-cell">Category</TH>
          <TH className="hidden w-32 pr-4 md:table-cell">Importance</TH>
          <TH className="hidden pr-4 lg:table-cell">Found on</TH>
          {canEdit ? (
            <TH>
              <span className="sr-only">Approve, edit or delete</span>
            </TH>
          ) : null}
        </TR>
      </THead>
      <TBody>
        {facts.map((fact) => (
          <TR key={fact.id} id={`fact-${fact.id}`} className="scroll-mt-24">
            <RowHead className="pr-4 md:min-w-[16rem]">
              <span className="text-ink">{fact.statement}</span>
              <span className="mt-1 block text-sm text-graphite lg:hidden">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="md:hidden">{FACT_CATEGORIES[fact.category].label}</span>
                  <span aria-hidden="true" className="md:hidden">·</span>
                  <span className="md:hidden">
                    <SeverityMark severity={fact.importance} />
                  </span>
                  {fact.validFrom ? (
                    <>
                      <span aria-hidden="true" className="md:hidden">·</span>
                      <span>From {formatDate(fact.validFrom)}</span>
                    </>
                  ) : null}
                </span>
                {fact.sourceUrl ? (
                  <span className="mt-0.5 block break-all">
                    <Source fact={fact} />
                  </span>
                ) : null}
              </span>
            </RowHead>
            <TD className="hidden pr-4 whitespace-nowrap md:table-cell">{FACT_CATEGORIES[fact.category].label}</TD>
            <TD className="hidden pr-4 whitespace-nowrap md:table-cell">
              <SeverityMark severity={fact.importance} />
            </TD>
            <TD className="hidden max-w-[15rem] pr-4 lg:table-cell">
              <Source fact={fact} />
              {fact.validFrom ? <span className="mt-0.5 block text-sm text-graphite">Valid from {formatDate(fact.validFrom)}</span> : null}
            </TD>
            {canEdit ? (
              <TD className="w-0">
                <div className="flex flex-col items-end gap-2 sm:flex-row sm:items-center sm:gap-4">
                  <ActionButton action={approveAction} fields={{ id: fact.id }} label={`Approve: ${fact.statement}`}>
                    Approve
                  </ActionButton>
                  <Link href={`/app/facts/${fact.id}/edit`} className={`${quietLink} text-sm`}>
                    Edit<span className="sr-only">: {fact.statement}</span>
                  </Link>
                  <ActionButton
                    action={deleteAction}
                    fields={{ id: fact.id }}
                    variant="quiet"
                    label={`Delete draft: ${fact.statement}`}
                  >
                    Delete
                  </ActionButton>
                </div>
              </TD>
            ) : null}
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

/** Facts that used to be true. Kept so old answers are labelled outdated. */
export function PastFactTable({ facts }: { facts: Fact[] }) {
  return (
    <Table caption="Past facts">
      <THead>
        <TR>
          <TH className="pr-4">Fact</TH>
          <TH className="hidden w-36 pr-4 md:table-cell">Category</TH>
          <TH className="hidden w-60 pr-4 sm:table-cell">Was true</TH>
          <TH className="hidden w-60 lg:table-cell">Source</TH>
        </TR>
      </THead>
      <TBody>
        {facts.map((fact) => (
          <TR key={fact.id} id={`fact-${fact.id}`} className="scroll-mt-24">
            <RowHead className="pr-4 md:min-w-[18rem]">
              <span className="text-graphite">{fact.statement}</span>
              <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-graphite lg:hidden">
                <span className="md:hidden">{FACT_CATEGORIES[fact.category].label}</span>
                <span aria-hidden="true" className="sm:hidden">·</span>
                <span className="sm:hidden">{period(fact)}</span>
                {fact.sourceUrl ? (
                  <span className="block w-full break-all">
                    <Source fact={fact} />
                  </span>
                ) : null}
              </span>
            </RowHead>
            <TD className="hidden pr-4 whitespace-nowrap text-graphite md:table-cell">{FACT_CATEGORIES[fact.category].label}</TD>
            <TD className="hidden pr-4 whitespace-nowrap text-graphite sm:table-cell">{period(fact)}</TD>
            <TD className="hidden max-w-[16rem] text-graphite lg:table-cell">
              <Source fact={fact} />
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

function period(fact: Fact): string {
  if (fact.validFrom) return `${formatDate(fact.validFrom)} to ${formatDate(fact.validTo)}`;
  return `Until ${formatDate(fact.validTo)}`;
}

/** Facts taken off the sheet. They are not used for checking. */
export function ArchivedFactTable({
  facts,
  canEdit,
  restoreAction,
}: {
  facts: Fact[];
  canEdit: boolean;
  restoreAction: ContentAction;
}) {
  return (
    <Table caption="Archived facts">
      <THead>
        <TR>
          <TH className="pr-4">Fact</TH>
          <TH className="hidden pr-4 md:table-cell">Category</TH>
          <TH className="hidden pr-4 sm:table-cell">Archived</TH>
          {canEdit ? (
            <TH>
              <span className="sr-only">Restore</span>
            </TH>
          ) : null}
        </TR>
      </THead>
      <TBody>
        {facts.map((fact) => (
          <TR key={fact.id} id={`fact-${fact.id}`}>
            <RowHead className="pr-4 md:min-w-[18rem]">
              <span className="text-graphite">{fact.statement}</span>
              <span className="mt-1 block text-sm text-graphite md:hidden">
                {FACT_CATEGORIES[fact.category].label}
                <span className="sm:hidden"> · Archived {formatDate(fact.updatedAt)}</span>
              </span>
            </RowHead>
            <TD className="hidden pr-4 whitespace-nowrap text-graphite md:table-cell">{FACT_CATEGORIES[fact.category].label}</TD>
            <TD className="hidden pr-4 whitespace-nowrap text-graphite sm:table-cell">{formatDate(fact.updatedAt)}</TD>
            {canEdit ? (
              <TD className="w-0 text-right">
                <ActionButton action={restoreAction} fields={{ id: fact.id }} label={`Restore: ${fact.statement}`}>
                  Restore
                </ActionButton>
              </TD>
            ) : null}
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
