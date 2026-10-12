"use client";

import { useState } from "react";
import type { ActionState } from "@/lib/actions";
import { PLATFORM_IDS, PLATFORMS, type PlatformId, type ScanFrequency } from "@/lib/domain/constants";
import { estimateMonthlyCost, monthlyRequests } from "@/lib/domain/costs";
import { formatMoney, formatNumber, plural } from "@/lib/domain/format";
import { Button } from "@/components/ui/button";
import { Choice, Fieldset } from "@/components/ui/field";
import { Details, Notice } from "@/components/ui/page";
import { frequencyLabel } from "./plan";
import { useFormAction } from "./use-form-action";

type ScanState = ActionState & { engineNotReady?: boolean };

function costRange(requests: number): string {
  const { low, high } = estimateMonthlyCost(requests);
  if (high === 0) return "under $1";
  return `${formatMoney(Math.max(low, 0), "USD")} to ${formatMoney(high, "USD")}`;
}

/** Step 4: choose the AI assistants, see the size of the scan, start it. */
export function ScanForm({
  initialPlatforms,
  platformLimit,
  simulated,
  runsPerQuestion,
  frequency,
  activeQuestions,
  planLabel,
  readOnly,
  action,
}: {
  initialPlatforms: PlatformId[];
  platformLimit: number;
  /** Platforms whose provider has no API key, so answers come from the simulator. */
  simulated: PlatformId[];
  runsPerQuestion: number;
  frequency: ScanFrequency;
  activeQuestions: number;
  planLabel: string;
  readOnly: boolean;
  action: (state: ScanState, formData: FormData) => Promise<ScanState>;
}) {
  const { state, pending, onSubmit } = useFormAction<ScanState>(action);
  const [chosen, setChosen] = useState<PlatformId[]>(initialPlatforms.slice(0, platformLimit));
  const atLimit = chosen.length >= platformLimit;

  const scanRequests = activeQuestions * chosen.length * runsPerQuestion;
  const perMonth = monthlyRequests({ questions: activeQuestions, platforms: chosen.length, runsPerQuestion, frequency });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-12">
      <fieldset disabled={readOnly} className="grid gap-12">
        <Fieldset
          legend="AI assistants"
          description={`Your ${planLabel} plan includes ${plural(platformLimit, "AI assistant")}. TrueCite turns on web search where the provider offers it, because many customers get answers based on live search.`}
        >
          <div className="grid gap-4">
            {PLATFORM_IDS.map((id) => {
              const checked = chosen.includes(id);
              return (
                <Choice
                  key={id}
                  name="platforms"
                  value={id}
                  checked={checked}
                  disabled={!checked && atLimit}
                  onChange={(e) =>
                    setChosen((current) =>
                      e.target.checked ? [...current, id] : current.filter((platform) => platform !== id),
                    )
                  }
                  label={PLATFORMS[id].name}
                  description={
                    <>
                      {PLATFORMS[id].access}
                      {simulated.includes(id) ? " · Simulated, no API key" : null}
                    </>
                  }
                />
              );
            })}
          </div>
          {state.fieldErrors?.platforms ? <p className="text-sm text-correction">{state.fieldErrors.platforms}</p> : null}
        </Fieldset>

        <section aria-labelledby="scan-size-title" className="grid gap-4">
          <div>
            <h2 id="scan-size-title" className="text-base font-semibold text-ink">
              Size of each scan
            </h2>
            <p className="mt-1 text-sm text-graphite">
              Each question is asked {plural(runsPerQuestion, "time")} on each assistant, because AI answers vary from one run
              to the next.
            </p>
          </div>
          <Details
            columns={2}
            items={[
              { label: "Questions switched on", value: <span className="figures">{formatNumber(activeQuestions)}</span> },
              { label: "Runs per question", value: <span className="figures">{runsPerQuestion}</span> },
              {
                label: "Requests in the first scan",
                value: (
                  <span className="figures">
                    {formatNumber(scanRequests)} <span className="text-graphite">· about {costRange(scanRequests)} in AI costs</span>
                  </span>
                ),
              },
              {
                label: "Scan schedule",
                value:
                  frequency === "manual" ? (
                    `${frequencyLabel(frequency)}`
                  ) : (
                    <span>
                      {frequencyLabel(frequency)}:{" "}
                      <span className="figures">{formatNumber(perMonth)}</span> requests a month, about {costRange(perMonth)}
                    </span>
                  ),
              },
            ]}
          />
          <p className="text-sm text-graphite">
            Costs are estimates at typical provider prices, about 1 to 5 cents a request with web search.
          </p>
        </section>
      </fieldset>

      <div className="grid gap-4 border-t border-rule pt-6">
        {state.engineNotReady ? (
          <Notice
            tone="attention"
            title="The first scan could not start"
            action={
              <Button type="submit" name="intent" value="finish" disabled={readOnly || pending}>
                Finish without scanning
              </Button>
            }
          >
            {state.message}
          </Notice>
        ) : state.message && !state.ok ? (
          <p role="alert" className="text-sm text-correction">
            {state.message}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button
            type="submit"
            variant="primary"
            name="intent"
            value="start"
            disabled={readOnly || pending || chosen.length === 0 || activeQuestions === 0}
            aria-busy={pending || undefined}
          >
            Start first scan
          </Button>
          {pending ? (
            <p role="status" className="text-sm text-graphite">
              Starting the scan.
            </p>
          ) : (
            <p className="text-sm text-graphite">Results appear on your dashboard as answers come in, usually within a few minutes.</p>
          )}
        </div>
      </div>
    </form>
  );
}
