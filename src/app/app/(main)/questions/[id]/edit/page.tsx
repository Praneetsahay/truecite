import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { QuestionForm } from "@/components/content/question-form";
import { TextLink } from "@/components/ui/button";
import { Details, PageHeader } from "@/components/ui/page";
import { requireClient, sameBrand } from "@/lib/auth/dal";
import { QUESTION_CATEGORIES } from "@/lib/domain/constants";
import { formatDate } from "@/lib/domain/format";
import { getQuestion } from "@/lib/queries/content";
import { updateQuestion } from "../../actions";

export const metadata: Metadata = { title: "Edit question" };

export default async function EditQuestionPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireClient();
  const { id } = await params;
  const found = await getQuestion(ctx, id);
  if (!found) notFound();
  const question = sameBrand(found, ctx);
  const back = `/app/questions?category=${question.category}#question-${question.id}`;
  if (!ctx.canEdit) redirect(back);

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Questions", href: "/app/questions" }, { label: "Edit question" }]}
        title="Edit question"
        description="Results from earlier scans stay with this question. For a different question, add a new one instead."
      />

      <Details
        columns={3}
        className="mb-10 max-w-3xl"
        items={[
          { label: "Category", value: QUESTION_CATEGORIES[question.category].label },
          { label: "Written by", value: question.origin === "custom" ? "Your team" : "TrueCite" },
          { label: "Added", value: formatDate(question.createdAt) },
        ]}
      />

      <div className="border-t border-rule pt-8">
        <QuestionForm
          action={updateQuestion}
          id={question.id}
          idPrefix="edit-question"
          submitLabel="Save question"
          showActive
          brandName={ctx.brand.name}
          defaults={{
            category: question.category,
            text: question.text,
            priority: question.priority,
            active: question.active,
          }}
        >
          <TextLink href={back} className="text-graphite hover:text-ink">
            Cancel
          </TextLink>
        </QuestionForm>
      </div>
    </>
  );
}
