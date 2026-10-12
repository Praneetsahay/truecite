import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getClientContext } from "@/lib/auth/dal";
import { Notice } from "@/components/ui/page";
import { OnboardingHeader } from "@/components/onboarding/onboarding-header";
import { ScrollTop } from "@/components/onboarding/scroll-top";
import { StepList } from "@/components/onboarding/step-list";
import { goToStep } from "./actions";
import { CompanyStep } from "./company-step";
import { FactsStep } from "./facts-step";
import { QuestionsStep } from "./questions-step";
import { ScanStep } from "./scan-step";

export const metadata: Metadata = { title: "Set up TrueCite" };

/* Every step depends on who is signed in and what they have saved, so the page renders per request. */
export const instant = false;

/** The four-step setup for a new client, outside the app shell. The step comes from brand.onboardingStep. */
export default async function OnboardingPage() {
  const ctx = await getClientContext();
  const step = ctx.brand.onboardingStep;
  if (step === "done") redirect("/app/dashboard");

  const readOnly = !ctx.canEdit;

  return (
    <div className="min-h-dvh">
      <OnboardingHeader step={step} viewingAs={ctx.viewingAs ? ctx.organization.name : null} />
      <main id="main" className="mx-auto w-full max-w-[880px] px-4 pt-8 pb-24 sm:px-6 lg:pt-12">
        <ScrollTop key={step} />
        <StepList current={step} goBack={readOnly ? undefined : goToStep} />
        {readOnly && !ctx.viewingAs ? (
          <Notice tone="attention" title="Your team is still setting up TrueCite" className="mb-10">
            You can see each step but not change it. An owner or member finishes the setup, and results appear on the
            dashboard after the first scan.
          </Notice>
        ) : null}
        {step === "company" ? <CompanyStep ctx={ctx} readOnly={readOnly} /> : null}
        {step === "facts" ? <FactsStep ctx={ctx} readOnly={readOnly} /> : null}
        {step === "questions" ? <QuestionsStep ctx={ctx} readOnly={readOnly} /> : null}
        {step === "scan" ? <ScanStep ctx={ctx} readOnly={readOnly} /> : null}
      </main>
    </div>
  );
}
