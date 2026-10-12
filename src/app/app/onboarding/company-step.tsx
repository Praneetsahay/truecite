import { asc, eq } from "drizzle-orm";
import type { ClientContext } from "@/lib/auth/dal";
import { competitors, getDb } from "@/lib/db";
import { PLANS } from "@/lib/domain/constants";
import { PageHeader } from "@/components/ui/page";
import { CompanyForm } from "@/components/onboarding/company-form";
import { planCompetitorLimit } from "@/components/onboarding/plan";
import { saveCompany } from "./actions";

export async function CompanyStep({ ctx, readOnly }: { ctx: ClientContext; readOnly: boolean }) {
  const db = await getDb();
  const rows = await db
    .select({ id: competitors.id, name: competitors.name, website: competitors.website })
    .from(competitors)
    .where(eq(competitors.brandId, ctx.brand.id))
    .orderBy(asc(competitors.createdAt));

  return (
    <>
      <PageHeader
        title="Company details"
        description="Tell TrueCite which company to check. The next steps use these details to draft your Fact Sheet and write customer questions."
      />
      <div className="border-t border-rule pt-8">
        <CompanyForm
          initial={{
            name: ctx.brand.name,
            website: ctx.brand.website,
            industry: ctx.brand.industry ?? "",
            markets: ctx.brand.markets,
            competitors: rows,
          }}
          competitorLimit={planCompetitorLimit(ctx.organization.plan)}
          planLabel={PLANS[ctx.organization.plan].label}
          readOnly={readOnly}
          action={saveCompany}
        />
      </div>
    </>
  );
}
