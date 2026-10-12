import { asc, eq } from "drizzle-orm";
import type { ClientContext } from "@/lib/auth/dal";
import { getDb, questions } from "@/lib/db";
import { PLANS } from "@/lib/domain/constants";
import { PageHeader, Section } from "@/components/ui/page";
import { ActionForm } from "@/components/onboarding/action-form";
import { planQuestionLimit } from "@/components/onboarding/plan";
import { AddQuestionForm, QuestionSetForm, type QuestionItem } from "@/components/onboarding/question-set";
import { addQuestion, generateQuestions, saveQuestions } from "./actions";

export async function QuestionsStep({ ctx, readOnly }: { ctx: ClientContext; readOnly: boolean }) {
  const db = await getDb();
  const items: QuestionItem[] = await db
    .select({
      id: questions.id,
      text: questions.text,
      category: questions.category,
      priority: questions.priority,
      active: questions.active,
      origin: questions.origin,
    })
    .from(questions)
    .where(eq(questions.brandId, ctx.brand.id))
    .orderBy(asc(questions.createdAt), asc(questions.text));

  const limit = planQuestionLimit(ctx.organization.plan);
  const planLabel = PLANS[ctx.organization.plan].label;
  const empty = items.length === 0;
  const addSection = (
    <Section
      id="add-question"
      title="Add your own question"
      description="Questions you add are checked like the generated ones."
      className="mt-12"
    >
      <div className="max-w-2xl">
        <AddQuestionForm action={addQuestion} readOnly={readOnly} brandName={ctx.brand.name} />
      </div>
    </Section>
  );

  return (
    <>
      <PageHeader
        title="Review your Question Set"
        description="These are the questions TrueCite asks each AI assistant, written the way customers ask them. Edit any that don't fit, add your own and switch off the ones that don't apply."
      />

      <section aria-labelledby="generate-title" className="grid gap-4 border-t border-rule pt-5">
        {empty ? (
          <div>
            <h2 id="generate-title" className="font-medium text-ink">
              No questions yet.
            </h2>
            <p className="mt-1 max-w-prose text-graphite">
              TrueCite writes questions about pricing, products, leadership, trust, comparisons with your competitors,
              policies, reputation and careers, using your approved facts. You can edit every one before the first scan.
            </p>
          </div>
        ) : (
          <h2 id="generate-title" className="sr-only">
            Generate questions
          </h2>
        )}
        <ActionForm
          action={generateQuestions}
          label="Generate my Question Set"
          variant={empty ? "primary" : "secondary"}
          pendingNote="Writing questions from your Fact Sheet."
          disabled={readOnly}
        />
      </section>

      {empty ? (
        addSection
      ) : (
        <div className="mt-10">
          <QuestionSetForm questions={items} limit={limit} planLabel={planLabel} readOnly={readOnly} action={saveQuestions}>
            {addSection}
          </QuestionSetForm>
        </div>
      )}
    </>
  );
}
