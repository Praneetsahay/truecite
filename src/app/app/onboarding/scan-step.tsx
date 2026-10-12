import { and, eq } from "drizzle-orm";
import type { ClientContext } from "@/lib/auth/dal";
import { getDb, questions } from "@/lib/db";
import { PLANS, PLATFORM_IDS } from "@/lib/domain/constants";
import { getSettings, providerStatus } from "@/lib/engine";
import { PageHeader } from "@/components/ui/page";
import { planPlatformLimit, planScanFrequency } from "@/components/onboarding/plan";
import { ScanForm } from "@/components/onboarding/scan-form";
import { startFirstScan } from "./actions";

export async function ScanStep({ ctx, readOnly }: { ctx: ClientContext; readOnly: boolean }) {
  const db = await getDb();
  const [active, settings] = await Promise.all([
    db
      .select({ id: questions.id })
      .from(questions)
      .where(and(eq(questions.brandId, ctx.brand.id), eq(questions.active, true))),
    getSettings(),
  ]);
  const keys = providerStatus();
  const simulated = PLATFORM_IDS.filter((id) => !keys[settings.models.answer[id].provider].configured);
  const plan = PLANS[ctx.organization.plan];

  return (
    <>
      <PageHeader
        title="Start your first scan"
        description="Choose the AI assistants to ask. TrueCite asks every question, checks each answer against your approved facts and shows what is wrong on your dashboard."
      />
      <div className="border-t border-rule pt-6">
        <ScanForm
          initialPlatforms={ctx.brand.platforms}
          platformLimit={planPlatformLimit(ctx.organization.plan)}
          simulated={simulated}
          runsPerQuestion={plan.runsPerQuestion}
          frequency={planScanFrequency(ctx.organization.plan)}
          activeQuestions={active.length}
          planLabel={plan.label}
          readOnly={readOnly}
          action={startFirstScan}
        />
      </div>
    </>
  );
}
