import type { Metadata } from "next";
import { ActionButton } from "@/components/content/action-button";
import { QuestionForm } from "@/components/content/question-form";
import { QuestionTable } from "@/components/content/question-table";
import { ButtonLink, TextLink } from "@/components/ui/button";
import { EmptyState, FilterLinks, Notice, PageHeader, Section } from "@/components/ui/page";
import { requireClient } from "@/lib/auth/dal";
import { PLANS, QUESTION_CATEGORIES, QUESTION_CATEGORY_IDS, type QuestionCategory } from "@/lib/domain/constants";
import { formatDate, formatNumber, plural } from "@/lib/domain/format";
import { getQuestionSet } from "@/lib/queries/content";
import { addQuestion, setQuestionActive, setQuestionPriority } from "./actions";

export const metadata: Metadata = { title: "Questions" };

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function questionsHref(category: QuestionCategory | null, inactive: boolean): string {
  const params = new URLSearchParams();
  if (category) params.set("category", category);
  if (inactive) params.set("inactive", "1");
  const query = params.toString();
  return query ? `/app/questions?${query}` : "/app/questions";
}

export default async function QuestionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireClient();
  const params = await searchParams;
  const set = await getQuestionSet(ctx);

  const categoryParam = first(params.category);
  const category = QUESTION_CATEGORY_IDS.includes(categoryParam as QuestionCategory) ? (categoryParam as QuestionCategory) : null;
  const savedId = first(params.saved);
  const savedRow = savedId ? set.rows.find((row) => row.id === savedId) : undefined;
  const offId = first(params.off);
  const offRow = offId ? set.rows.find((row) => row.id === offId && !row.active) : undefined;
  // A question that was just switched off stays in view after saving it.
  const showInactive = first(params.inactive) === "1" || Boolean(savedRow && !savedRow.active);
  const canEdit = ctx.canEdit;
  const plan = PLANS[ctx.organization.plan].label;
  const atLimit = set.activeCount >= set.limit;

  const visible = set.rows.filter((row) => (showInactive || row.active) && (!category || row.category === category));
  const groups = QUESTION_CATEGORY_IDS.filter((id) => !category || id === category)
    .map((id) => ({ category: id, rows: visible.filter((row) => row.category === id) }))
    .filter((group) => group.rows.length > 0)
    .map((group) => ({
      ...group,
      rows: [...group.rows].sort(
        (a, b) => Number(b.active) - Number(a.active) || Number(a.priority !== "key") - Number(b.priority !== "key"),
      ),
    }));

  // The scan most results come from, to date the column once.
  const checkedDays = new Map<string, number>();
  for (const row of set.rows) {
    if (row.result.kind === "unchecked" || !row.active) continue;
    const day = formatDate(row.result.checkedAt);
    checkedDays.set(day, (checkedDays.get(day) ?? 0) + 1);
  }
  const resultDay = [...checkedDays.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  const count = (id: QuestionCategory) => (showInactive ? set.counts[id].total : set.counts[id].active);
  const totalShown = showInactive ? set.rows.length : set.activeCount;

  const usage = set.customLimit
    ? `${formatNumber(set.activeCount)} questions in use.`
    : `${formatNumber(set.activeCount)} of ${formatNumber(set.limit)} questions in use on your ${plan} plan.`;

  return (
    <>
      <PageHeader
        title="Questions"
        description={
          <>
            The questions TrueCite asks AI assistants about {ctx.brand.name}, written the way customers ask them. Key
            questions are checked on every scan; standard ones can be checked less often.
          </>
        }
        actions={
          canEdit && set.rows.length > 0 && !atLimit ? (
            <ButtonLink href="#add-question" variant="secondary">
              Add a question
            </ButtonLink>
          ) : null
        }
      />

      {savedRow ? (
        <Notice tone="done" title="Question saved" className="mb-8">
          {savedRow.active
            ? "TrueCite asks it as written from the next scan. Earlier answers stay with it."
            : "It is switched off and keeps its history. Switch it on again at any time."}
        </Notice>
      ) : null}

      {offRow && canEdit ? (
        <Notice
          tone="done"
          title="Question switched off"
          className="mb-8"
          action={
            <ActionButton action={setQuestionActive} fields={{ id: offRow.id, active: "true" }} size="sm">
              Switch it back on
            </ActionButton>
          }
        >
          “{offRow.text}” is no longer asked in scans and keeps its history. It is listed under switched-off questions.
        </Notice>
      ) : null}

      {set.rows.length === 0 ? (
        <EmptyState title="No questions yet.">
          Add the questions your customers ask about {ctx.brand.name}, such as what it costs or whether it is safe to use.
          TrueCite asks each one on every AI platform at the next scan.
        </EmptyState>
      ) : (
        <>
          <div className="mb-6 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
            <p className="text-ink">
              {usage}
              {set.inactiveCount > 0 ? (
                <span className="text-graphite"> {plural(set.inactiveCount, "question")} switched off.</span>
              ) : null}
            </p>
            {set.inactiveCount > 0 ? (
              <TextLink href={questionsHref(category, !showInactive)} className="text-sm text-graphite hover:text-ink">
                {showInactive ? "Hide switched-off questions" : "Show switched-off questions"}
              </TextLink>
            ) : null}
          </div>

          <FilterLinks
            label="Question category"
            items={[
              { label: "All", href: questionsHref(null, showInactive), active: category === null, count: totalShown },
              ...QUESTION_CATEGORY_IDS.filter((id) => set.counts[id].total > 0).map((id) => ({
                label: QUESTION_CATEGORIES[id].label,
                href: questionsHref(id, showInactive),
                active: category === id,
                count: count(id),
              })),
            ]}
          />

          {resultDay ? (
            <p className="mt-4 text-sm text-graphite">
              Latest results from the scan on {resultDay}. <span className="highlight text-ink">Mixed</span> means a
              wrong statement appeared only once, or a claim your Fact Sheet does not cover.
            </p>
          ) : (
            <p className="mt-4 text-sm text-graphite">Results appear here after the first scan finishes.</p>
          )}

          {groups.length === 0 ? (
            <EmptyState title="No questions in use here." className="mt-8">
              Every question in this category is switched off.{" "}
              <TextLink href={questionsHref(category, true)}>Show switched-off questions</TextLink> to switch one on.
            </EmptyState>
          ) : (
            <div className="mt-8">
              {groups.map((group) => {
                const key = group.rows.filter((row) => row.priority === "key" && row.active).length;
                return (
                  <Section
                    key={group.category}
                    id={`category-${group.category}`}
                    title={QUESTION_CATEGORIES[group.category].label}
                    description={`${plural(group.rows.length, "question")}, ${key} key`}
                  >
                    <QuestionTable
                      rows={group.rows}
                      caption={`${QUESTION_CATEGORIES[group.category].label} questions`}
                      canEdit={canEdit}
                      savedId={savedId}
                      activeAction={setQuestionActive}
                      priorityAction={setQuestionPriority}
                      returnTo={showInactive ? undefined : questionsHref(category, false)}
                    />
                  </Section>
                );
              })}
            </div>
          )}
        </>
      )}

      {canEdit ? (
        <Section
          id="add-question"
          title="Add your own question"
          description="Questions you add are asked on every AI platform from the next scan, with the same runs as the rest."
          className="scroll-mt-24"
        >
          {atLimit && !set.customLimit ? (
            <Notice tone="attention" title={`All ${set.limit} questions on your ${plan} plan are in use`}>
              Switch off a question you need less to add another, or{" "}
              <TextLink href="/app/billing" className="text-ink">
                ask to change plan
              </TextLink>
              .
            </Notice>
          ) : atLimit ? (
            <Notice tone="attention" title={`All ${set.limit} questions are in use`}>
              Switch off a question you need less to add another, or contact TrueCite to raise your limit.
            </Notice>
          ) : (
            <QuestionForm
              action={addQuestion}
              idPrefix="add-question"
              submitLabel="Add question"
              brandName={ctx.brand.name}
              defaults={{ category: category ?? "", priority: "standard" }}
            />
          )}
        </Section>
      ) : null}

      {!canEdit ? (
        <p className="mt-10 border-t border-rule pt-5 text-sm text-graphite">
          {ctx.viewingAs
            ? "You are viewing this account as support, so questions are read-only."
            : "Your role can read the Question Set. Ask an owner or member to add or change questions."}
        </p>
      ) : null}
    </>
  );
}
