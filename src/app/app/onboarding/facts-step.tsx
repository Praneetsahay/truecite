import { and, asc, eq, inArray } from "drizzle-orm";
import type { ClientContext } from "@/lib/auth/dal";
import { facts, getDb } from "@/lib/db";
import { FACT_CATEGORIES, FACT_CATEGORY_IDS, SEVERITY_ORDER } from "@/lib/domain/constants";
import { domainOf, plural } from "@/lib/domain/format";
import { PageHeader, Section } from "@/components/ui/page";
import { ActionForm } from "@/components/onboarding/action-form";
import { AddFactForm, FactList, type FactItem } from "@/components/onboarding/fact-list";
import { MIN_APPROVED_FACTS } from "@/components/onboarding/plan";
import { addFact, approveAllFacts, approveFact, deleteFact, draftFacts, finishFacts, updateFact } from "./actions";

export async function FactsStep({ ctx, readOnly }: { ctx: ClientContext; readOnly: boolean }) {
  const db = await getDb();
  const rows = await db
    .select({
      id: facts.id,
      category: facts.category,
      statement: facts.statement,
      importance: facts.importance,
      validFrom: facts.validFrom,
      sourceUrl: facts.sourceUrl,
      status: facts.status,
      origin: facts.origin,
    })
    .from(facts)
    .where(and(eq(facts.brandId, ctx.brand.id), inArray(facts.status, ["draft", "approved"])))
    .orderBy(asc(facts.createdAt));

  const items: FactItem[] = rows.sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.importance) - SEVERITY_ORDER.indexOf(b.importance),
  );
  const approved = items.filter((f) => f.status === "approved").length;
  const drafts = items.length - approved;
  const ready = approved >= MIN_APPROVED_FACTS;
  const site = domainOf(ctx.brand.website);
  const actions = { approve: approveFact, update: updateFact, remove: deleteFact };

  // One primary action at a time: draft first, then approve, then continue.
  const primary = ready ? "continue" : items.length === 0 ? "draft" : drafts > 0 ? "approve" : "none";

  return (
    <>
      <PageHeader
        title="Review your Fact Sheet"
        description={
          <>
            TrueCite checks every AI answer against these facts. Only approved facts are used for checking, so approve the
            ones that are right and correct the rest.
          </>
        }
      />

      {/* The draft button keeps its place in the tree, so its result message survives the refresh. */}
      <section aria-labelledby="draft-title" className="grid gap-4 border-t border-rule pt-5">
        {items.length === 0 ? (
          <div>
            <h2 id="draft-title" className="font-medium text-ink">
              No facts yet.
            </h2>
            <p className="mt-1 max-w-prose text-graphite">
              TrueCite reads the public pages of {site}, such as the home, about, pricing, product, leadership, policy and
              press pages, and drafts facts for you to review. It takes up to a minute. You can also add facts by hand below.
            </p>
          </div>
        ) : drafts === 0 ? (
          <h2 id="draft-title" className="text-graphite">
            All <span className="figures font-medium text-ink">{approved}</span> facts approved.
          </h2>
        ) : (
          <h2 id="draft-title" className="text-graphite">
            <span className="figures font-medium text-ink">{approved}</span> approved,{" "}
            <span className="figures font-medium text-ink">{drafts}</span> waiting for your review.
          </h2>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
          {drafts > 0 ? (
            <ActionForm
              action={approveAllFacts}
              inline
              label="Approve all"
              variant={primary === "approve" ? "primary" : "secondary"}
              disabled={readOnly}
            />
          ) : null}
          <ActionForm
            action={draftFacts}
            inline
            label="Draft my Fact Sheet"
            variant={primary === "draft" ? "primary" : "secondary"}
            pendingNote={`Reading ${site}. This can take up to a minute.`}
            disabled={readOnly}
          />
        </div>
      </section>

      {FACT_CATEGORY_IDS.map((category) => {
        const group = items.filter((f) => f.category === category);
        if (group.length === 0) return null;
        return (
          <Section
            key={category}
            id={`facts-${category}`}
            title={FACT_CATEGORIES[category].label}
            description={plural(group.length, "fact")}
            rule={false}
          >
            <FactList facts={group} actions={actions} readOnly={readOnly} />
          </Section>
        );
      })}

      <Section
        id="add-fact"
        title="Add a fact"
        description="For anything the draft missed. Facts you add are approved straight away. Use public facts only; TrueCite never needs private data."
      >
        <div className="max-w-2xl">
          <AddFactForm action={addFact} readOnly={readOnly} />
        </div>
      </Section>

      <div className="mt-12 grid gap-3 border-t border-rule pt-6">
        <p className="text-sm text-graphite">
          {ready
            ? `${plural(approved, "approved fact")}. You can change the Fact Sheet at any time after setup.`
            : `Approve at least ${MIN_APPROVED_FACTS} facts to continue. ${approved} approved so far.`}
        </p>
        <ActionForm
          action={finishFacts}
          label="Continue to questions"
          variant={primary === "continue" ? "primary" : "secondary"}
          disabled={readOnly || !ready}
        />
      </div>
    </>
  );
}
