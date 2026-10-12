import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ActionButton } from "@/components/content/action-button";
import { FactForm } from "@/components/content/fact-form";
import { RetireForm } from "@/components/content/retire-form";
import { TextLink } from "@/components/ui/button";
import { Details, PageHeader, Section } from "@/components/ui/page";
import { requireClient, sameBrand } from "@/lib/auth/dal";
import { FACT_CATEGORIES, FACT_STATUSES } from "@/lib/domain/constants";
import { formatDate } from "@/lib/domain/format";
import { dayOf, getFact, isPastFact } from "@/lib/queries/content";
import { approveFact, archiveFact, deleteDraftFact, retireFact, updateFact } from "../../actions";

export const metadata: Metadata = { title: "Edit fact" };

export default async function EditFactPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireClient();
  const { id } = await params;
  const found = await getFact(ctx, id);
  if (!found) notFound();
  const fact = sameBrand(found, ctx);
  if (!ctx.canEdit) redirect(`/app/facts#fact-${fact.id}`);

  const today = dayOf(ctx.now);
  const past = isPastFact(fact, today);
  const draft = fact.status === "draft";
  const canRetire = fact.status === "approved" && !past && !(fact.validFrom && fact.validFrom > today);

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Fact Sheet", href: "/app/facts" }, { label: "Edit fact" }]}
        title={draft ? "Edit draft fact" : "Edit fact"}
        description={
          draft
            ? "Fix the wording or the details, then approve it. Drafts are not used for checking."
            : "Use this to correct a mistake in the fact itself. If the fact was right and has since changed, mark it as no longer true instead."
        }
      />

      <Details
        columns={3}
        className="mb-10 max-w-3xl"
        items={[
          { label: "Status", value: past ? "Past fact" : FACT_STATUSES[fact.status].label },
          { label: "Category", value: FACT_CATEGORIES[fact.category].label },
          {
            label: fact.approvedAt ? "Approved" : "Added",
            value: formatDate(fact.approvedAt ?? fact.createdAt),
          },
        ]}
      />

      <Section title={draft ? "Draft" : "Correct this fact"} id="edit">
        <FactForm
          action={updateFact}
          id={fact.id}
          idPrefix="edit-fact"
          submitLabel="Save fact"
          submitVariant={draft ? "secondary" : "primary"}
          defaults={{
            category: fact.category,
            statement: fact.statement,
            importance: fact.importance,
            validFrom: fact.validFrom,
            sourceUrl: fact.sourceUrl,
          }}
        >
          <TextLink href={`/app/facts#fact-${fact.id}`} className="text-graphite hover:text-ink">
            Cancel
          </TextLink>
        </FactForm>
      </Section>

      {draft ? (
        <Section title="Approve or delete" description="Approving uses the fact as saved above for every check from the next scan.">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <ActionButton action={approveFact} fields={{ id: fact.id }} variant="primary" size="md">
              Approve
            </ActionButton>
            <ActionButton action={deleteDraftFact} fields={{ id: fact.id }} variant="quiet" size="md">
              Delete draft
            </ActionButton>
          </div>
        </Section>
      ) : null}

      {canRetire ? (
        <Section
          id="no-longer-true"
          title="No longer true"
          description={
            <>
              The fact stops being valid today and moves to past facts. Former facts let TrueCite label answers that
              repeat them as outdated, which also points to where they came from.
            </>
          }
          className="scroll-mt-24"
        >
          <RetireForm action={retireFact} id={fact.id} importance={fact.importance} todayLabel={formatDate(today)} />
        </Section>
      ) : null}

      {!draft && fact.status !== "archived" ? (
        <Section
          title="Archive"
          description="For a fact that was never right. Archived facts are not used for checking, not even to label outdated answers."
        >
          <ActionButton action={archiveFact} fields={{ id: fact.id }} variant="secondary" size="md">
            Archive fact
          </ActionButton>
        </Section>
      ) : null}
    </>
  );
}
