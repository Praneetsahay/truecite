import type { Metadata } from "next";
import { ActionButton } from "@/components/content/action-button";
import { FactForm } from "@/components/content/fact-form";
import { ArchivedFactTable, CurrentFactTable, DraftFactTable, PastFactTable } from "@/components/content/fact-tables";
import { ButtonLink, TextLink } from "@/components/ui/button";
import { EmptyState, Notice, PageHeader, Section } from "@/components/ui/page";
import { requireClient } from "@/lib/auth/dal";
import { FACT_CATEGORIES } from "@/lib/domain/constants";
import { plural } from "@/lib/domain/format";
import { getFactSheet } from "@/lib/queries/content";
import { addFact, approveAllFacts, approveFact, deleteDraftFact, restoreFact } from "./actions";

export const metadata: Metadata = { title: "Fact Sheet" };

/** What the page says after a change made on the edit page. */
const DONE_NOTICES = {
  updated: { title: "Fact saved", body: "Answers are checked against the new wording from the next scan." },
  "draft-updated": { title: "Draft saved", body: "It is still a draft. Approve it to use it for checking." },
  retired: {
    title: "Moved to past facts",
    body: "AI answers that still give this fact will be labelled outdated.",
  },
  replaced: {
    title: "Moved to past facts, and the new fact added",
    body: "AI answers that still give the old fact will be labelled outdated, which also hints at where they came from.",
  },
  archived: { title: "Fact archived", body: "It is no longer used for checking. Archived facts are listed at the end of this page." },
} as const;

type DoneKey = keyof typeof DONE_NOTICES;

export default async function FactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireClient();
  const params = await searchParams;
  const sheet = await getFactSheet(ctx);
  const doneParam = typeof params.done === "string" ? params.done : "";
  const done = doneParam in DONE_NOTICES ? DONE_NOTICES[doneParam as DoneKey] : null;
  const showArchived = params.archived === "1";
  const canEdit = ctx.canEdit;
  const brand = ctx.brand.name;
  const empty = sheet.drafts.length === 0 && sheet.currentCount === 0 && sheet.past.length === 0;

  return (
    <>
      <PageHeader
        title="Fact Sheet"
        description={
          <>
            The facts about {brand} that every AI answer is checked against. Only approved facts are used, and their dates
            let TrueCite tell an outdated answer from a wrong one.
          </>
        }
        actions={
          canEdit && !empty ? (
            <ButtonLink href="#add-fact" variant="secondary">
              Add a fact
            </ButtonLink>
          ) : null
        }
      />

      {done ? (
        <Notice tone="done" title={done.title} className="mb-8">
          {done.body}
        </Notice>
      ) : null}

      {!canEdit ? (
        <p className="mb-8 text-sm text-graphite">
          {ctx.viewingAs
            ? "You are viewing this account as support, so the Fact Sheet is read-only."
            : "Your role can read the Fact Sheet. Ask an owner or member to change a fact."}
        </p>
      ) : null}

      {sheet.drafts.length > 0 ? (
        <Section id="drafts" rule={false}>
          <Notice
            tone="attention"
            title={`${plural(sheet.drafts.length, "draft fact")} ${sheet.drafts.length === 1 ? "waits" : "wait"} for approval`}
            action={
              canEdit ? (
                <ActionButton action={approveAllFacts} fields={{}} variant="primary" size="md" className="justify-end">
                  Approve all
                </ActionButton>
              ) : null
            }
          >
            TrueCite drafted {sheet.drafts.length === 1 ? "this" : "these"} from your website. Approve what is right, edit
            what is close and delete the rest. Drafts are not used for checking.
          </Notice>
          <div className="mt-6">
            <DraftFactTable facts={sheet.drafts} canEdit={canEdit} approveAction={approveFact} deleteAction={deleteDraftFact} />
          </div>
        </Section>
      ) : null}

      {empty ? (
        <EmptyState title="Your Fact Sheet is empty.">
          Add the facts AI assistants should get right, starting with prices, leadership and policies. TrueCite checks
          every answer against them from the next scan.
        </EmptyState>
      ) : sheet.currentCount === 0 ? (
        <EmptyState title="No approved facts yet." className="mt-10">
          Approve the drafts above or add a fact below. Until then, answers cannot be checked.
        </EmptyState>
      ) : (
        sheet.current.map((group) => (
          <Section
            key={group.category}
            id={`category-${group.category}`}
            title={FACT_CATEGORIES[group.category].label}
            description={plural(group.facts.length, "fact")}
          >
            <CurrentFactTable
              facts={group.facts}
              caption={`${FACT_CATEGORIES[group.category].label} facts`}
              canEdit={canEdit}
            />
          </Section>
        ))
      )}

      {sheet.past.length > 0 ? (
        <Section
          id="past"
          title="Past facts"
          description="Facts that used to be true. TrueCite keeps them so an answer that repeats one is labelled outdated, not just wrong."
        >
          <PastFactTable facts={sheet.past} />
        </Section>
      ) : null}

      {canEdit ? (
        <Section
          id="add-fact"
          title="Add a fact"
          description="A public fact about your company. Facts you add are approved and used from the next scan."
          className="scroll-mt-24"
        >
          <FactForm action={addFact} idPrefix="add-fact" submitLabel="Add fact" submitVariant={sheet.drafts.length > 0 ? "secondary" : "primary"} />
        </Section>
      ) : null}

      {sheet.archived.length > 0 ? (
        showArchived ? (
          <Section
            id="archived"
            title="Archived facts"
            description="Taken off the Fact Sheet and not used for checking."
            actions={
              <TextLink href="/app/facts" className="text-sm text-graphite hover:text-ink">
                Hide archived facts
              </TextLink>
            }
          >
            <ArchivedFactTable facts={sheet.archived} canEdit={canEdit} restoreAction={restoreFact} />
          </Section>
        ) : (
          <p className="mt-14 border-t border-rule pt-5 text-sm text-graphite">
            {plural(sheet.archived.length, "archived fact")}, not used for checking.{" "}
            <TextLink href="/app/facts?archived=1#archived" className="text-graphite hover:text-ink">
              Show {sheet.archived.length === 1 ? "it" : "them"}
            </TextLink>
          </p>
        )
      ) : null}
    </>
  );
}
