"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Choice, Field, FormMessage, Input, Select } from "@/components/ui/field";
import { Section } from "@/components/ui/page";
import { PLATFORM_IDS, PLATFORMS, type PlatformId } from "@/lib/domain/constants";
import type { ModelPrice } from "@/lib/domain/costs";
import type { Effort, FeaturesSetting, Settings } from "@/lib/engine";
import { cx } from "@/lib/cx";
import { SaveButton, useKeepValues, type FormAction } from "./action-form";

/*
  All settings in one form with one Save button, so a change to a model and
  its price goes in together.
*/

const PROVIDERS = [
  { id: "openai", label: "OpenAI" },
  { id: "google", label: "Google" },
  { id: "perplexity", label: "Perplexity" },
  { id: "anthropic", label: "Anthropic" },
] as const;

const EFFORTS: { id: Effort; label: string }[] = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
];

const FEATURES: { key: keyof FeaturesSetting; label: string; description: string }[] = [
  { key: "reviewQueue", label: "Review queue", description: "Every new issue waits for an admin before the client sees it." },
  { key: "sourceTracing", label: "Source tracing", description: "Reads the pages AI answers cite to find where a wrong statement comes from." },
  { key: "instantAlerts", label: "Instant alerts", description: "Clients with an instant alert rule get an email as soon as an issue is approved." },
  { key: "competitorScans", label: "Competitor scans", description: "Also asks about each client's competitors, for estimated comparison scores." },
  {
    key: "simulateWithoutKeys",
    label: "Simulated answers without API keys",
    description: "A platform without a key answers from the built-in simulator instead of failing. Turn off before real clients.",
  },
  { key: "crisisMode", label: "Crisis mode", description: "Allows daily scans for Enterprise clients while a story is breaking." },
  { key: "indianLanguages", label: "Hindi and Hinglish questions", description: "Lets clients add questions in Hindi and Hinglish." },
];

type PriceRow = ModelPrice & { key: number };

function ErrorText({ id, error }: { id: string; error?: string }) {
  if (!error) return null;
  return (
    <p id={`${id}-error`} className="text-sm text-correction">
      {error}
    </p>
  );
}

function invalid(id: string, error?: string) {
  return error ? ({ "aria-invalid": true, "aria-describedby": `${id}-error` } as const) : {};
}

export function SettingsForm({ action, settings }: { action: FormAction; settings: Settings }) {
  const { state, onSubmit, pending } = useKeepValues(action);
  const err = (name: string) => state.fieldErrors?.[name];
  const nextKey = useRef(settings.prices.length);
  const [prices, setPrices] = useState<PriceRow[]>(() => settings.prices.map((row, key) => ({ ...row, key })));
  const [providers, setProviders] = useState<Record<string, string>>(() => ({
    ...Object.fromEntries(PLATFORM_IDS.map((id) => [id, settings.models.answer[id].provider])),
    checker: settings.models.checker.provider,
  }));

  function addRow() {
    const key = nextKey.current++;
    setPrices((rows) => [...rows, { key, provider: "openai", model: "", inputPerMTok: 0, outputPerMTok: 0, perSearchCall: 0 }]);
  }

  const modelOptions = [...new Set(prices.map((row) => row.model).filter(Boolean))];

  return (
    <form onSubmit={onSubmit} noValidate>
      <datalist id="model-options">
        {modelOptions.map((model) => (
          <option key={model} value={model} />
        ))}
      </datalist>

      <Section
        id="models"
        rule={false}
        title="Answer models"
        description="The model that answers customer questions on each platform. Web search should stay on: it is how assistants answer real people."
      >
        <div className="grid gap-6">
          {PLATFORM_IDS.map((id: PlatformId) => {
            const current = settings.models.answer[id];
            const base = `answer.${id}`;
            const anthropic = providers[id] === "anthropic";
            return (
              <fieldset key={id} className="grid gap-3 border-t border-rule pt-4 first:border-t-0 first:pt-0">
                <legend className="sr-only">{PLATFORMS[id].name}</legend>
                <div className="grid gap-3 sm:grid-cols-[7rem_10rem_minmax(0,1fr)_8rem] sm:items-start">
                  <p aria-hidden="true" className="font-medium text-ink sm:pt-7">
                    {PLATFORMS[id].name}
                  </p>
                  <Field label="Provider" htmlFor={`${base}.provider`}>
                    <Select
                      id={`${base}.provider`}
                      name={`${base}.provider`}
                      defaultValue={current.provider}
                      onChange={(event) => setProviders((p) => ({ ...p, [id]: event.target.value }))}
                    >
                      {PROVIDERS.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <div className="grid gap-1.5">
                    <label htmlFor={`${base}.model`} className="text-sm font-medium text-ink">
                      Model <span className="sr-only">for {PLATFORMS[id].name}</span>
                    </label>
                    <Input
                      id={`${base}.model`}
                      name={`${base}.model`}
                      defaultValue={current.model}
                      list="model-options"
                      autoComplete="off"
                      spellCheck={false}
                      {...invalid(`${base}.model`, err(`${base}.model`))}
                    />
                    <ErrorText id={`${base}.model`} error={err(`${base}.model`)} />
                  </div>
                  <Field label="Effort" htmlFor={`${base}.effort`}>
                    <Select
                      id={`${base}.effort`}
                      name={`${base}.effort`}
                      defaultValue={current.effort ?? "medium"}
                      disabled={!anthropic}
                      aria-describedby={!anthropic ? `${base}.effort-hint` : undefined}
                    >
                      {EFFORTS.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.label}
                        </option>
                      ))}
                    </Select>
                    {!anthropic ? (
                      <span id={`${base}.effort-hint`} className="sr-only">
                        Effort applies to Claude models only.
                      </span>
                    ) : null}
                  </Field>
                </div>
                <div className="sm:pl-[calc(7rem+0.75rem)]">
                  <Choice name={`${base}.webSearch`} defaultChecked={current.webSearch} label={`Web search for ${PLATFORMS[id].name}`} />
                </div>
              </fieldset>
            );
          })}
        </div>
        <p className="mt-4 text-sm text-graphite">Effort applies to Claude models only.</p>
      </Section>

      <Section id="checker" title="Checker model" description="A cheaper model that extracts each claim from an answer and checks it against the Fact Sheet.">
        <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)_8rem] sm:items-start">
          <Field label="Provider" htmlFor="checker.provider">
            <Select
              id="checker.provider"
              name="checker.provider"
              defaultValue={settings.models.checker.provider}
              onChange={(event) => setProviders((p) => ({ ...p, checker: event.target.value }))}
            >
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid gap-1.5">
            <label htmlFor="checker.model" className="text-sm font-medium text-ink">
              Model
            </label>
            <Input
              id="checker.model"
              name="checker.model"
              defaultValue={settings.models.checker.model}
              list="model-options"
              autoComplete="off"
              spellCheck={false}
              {...invalid("checker.model", err("checker.model"))}
            />
            <ErrorText id="checker.model" error={err("checker.model")} />
          </div>
          <Field label="Effort" htmlFor="checker.effort">
            <Select
              id="checker.effort"
              name="checker.effort"
              defaultValue={settings.models.checker.effort ?? "low"}
              disabled={providers.checker !== "anthropic"}
            >
              {EFFORTS.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Section>

      <Section
        id="prices"
        title="Price table"
        description="USD per million tokens and per web search call. These are estimates: confirm them on each provider's pricing page, because every cost in TrueCite is calculated from this table."
      >
        <div className="relative -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <table className="w-full min-w-[44rem] border-collapse text-left text-md">
            <caption className="sr-only">Model prices</caption>
            <thead className="border-b border-rule-strong">
              <tr>
                <th scope="col" className="py-2 pr-3 text-sm font-normal text-graphite">
                  Provider
                </th>
                <th scope="col" className="py-2 pr-3 text-sm font-normal text-graphite">
                  Model
                </th>
                <th scope="col" className="py-2 pr-3 text-right text-sm font-normal text-graphite">
                  Input, $ per M
                </th>
                <th scope="col" className="py-2 pr-3 text-right text-sm font-normal text-graphite">
                  Output, $ per M
                </th>
                <th scope="col" className="py-2 pr-3 text-right text-sm font-normal text-graphite">
                  $ per search
                </th>
                <th scope="col" className="py-2 text-sm font-normal text-graphite">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {prices.map((row, index) => {
                const label = row.model || `row ${index + 1}`;
                const rowError =
                  err(`prices.${index}.model`) ??
                  err(`prices.${index}.inputPerMTok`) ??
                  err(`prices.${index}.outputPerMTok`) ??
                  err(`prices.${index}.perSearchCall`) ??
                  err(`prices.${index}.provider`);
                return (
                  <tr key={row.key} className="border-b border-rule align-top">
                    <td className="w-36 py-2 pr-3">
                      <Select name="price.provider" defaultValue={row.provider} aria-label={`Provider for ${label}`}>
                        {PROVIDERS.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.label}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="py-2 pr-3">
                      <Input
                        name="price.model"
                        defaultValue={row.model}
                        aria-label={`Model name, ${label}`}
                        autoComplete="off"
                        spellCheck={false}
                        className="min-w-40"
                        onChange={(event) => {
                          const model = event.target.value;
                          setPrices((rows) => rows.map((r) => (r.key === row.key ? { ...r, model } : r)));
                        }}
                        {...invalid(`price-${row.key}`, rowError)}
                      />
                      <ErrorText id={`price-${row.key}`} error={rowError} />
                    </td>
                    {(
                      [
                        ["price.input", row.inputPerMTok, "Input price per million tokens"],
                        ["price.output", row.outputPerMTok, "Output price per million tokens"],
                        ["price.search", row.perSearchCall, "Price per search call"],
                      ] as const
                    ).map(([name, value, text]) => (
                      <td key={name} className="w-32 py-2 pr-3">
                        <Input
                          name={name}
                          type="number"
                          inputMode="decimal"
                          step="any"
                          min={0}
                          defaultValue={value}
                          aria-label={`${text}, ${label}`}
                          className="text-right"
                        />
                      </td>
                    ))}
                    <td className="py-2 align-middle">
                      <Button
                        variant="quiet"
                        size="sm"
                        onClick={() => setPrices((rows) => rows.filter((r) => r.key !== row.key))}
                        disabled={prices.length <= 1}
                      >
                        Remove<span className="sr-only"> {label}</span>
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <Button size="sm" onClick={addRow}>
            Add price row
          </Button>
          {err("prices") ? <p className="text-sm text-correction">{err("prices")}</p> : null}
        </div>
      </Section>

      <Section id="features" title="Feature switches">
        <div className="grid max-w-2xl gap-4">
          {FEATURES.map((feature) => (
            <Choice
              key={feature.key}
              name={`features.${feature.key}`}
              defaultChecked={settings.features[feature.key]}
              label={feature.label}
              description={feature.description}
            />
          ))}
        </div>
      </Section>

      <Section id="limits" title="Limits" description="How hard the scan worker pushes the providers.">
        <div className="grid max-w-2xl gap-4 sm:grid-cols-3">
          <Field
            label="Requests at once"
            htmlFor="limits.maxConcurrentRequests"
            hint="Across all scans"
            error={err("limits.maxConcurrentRequests")}
          >
            <Input
              id="limits.maxConcurrentRequests"
              name="limits.maxConcurrentRequests"
              type="number"
              min={1}
              max={32}
              defaultValue={settings.limits.maxConcurrentRequests}
              {...invalid("limits.maxConcurrentRequests", err("limits.maxConcurrentRequests"))}
            />
          </Field>
          <Field label="Timeout, seconds" htmlFor="limits.requestTimeoutSeconds" hint="Per request" error={err("limits.requestTimeoutSeconds")}>
            <Input
              id="limits.requestTimeoutSeconds"
              name="limits.requestTimeoutSeconds"
              type="number"
              min={5}
              max={300}
              defaultValue={Math.round(settings.limits.requestTimeoutMs / 1000)}
              {...invalid("limits.requestTimeoutSeconds", err("limits.requestTimeoutSeconds"))}
            />
          </Field>
          <Field label="Attempts" htmlFor="limits.maxAttempts" hint="Before a job is marked failed" error={err("limits.maxAttempts")}>
            <Input
              id="limits.maxAttempts"
              name="limits.maxAttempts"
              type="number"
              min={1}
              max={10}
              defaultValue={settings.limits.maxAttempts}
              {...invalid("limits.maxAttempts", err("limits.maxAttempts"))}
            />
          </Field>
        </div>
      </Section>

      <div className={cx("mt-10 flex flex-col items-start gap-3 border-t border-rule pt-6 sm:flex-row sm:items-center sm:gap-4")}>
        <SaveButton pending={pending}>Save settings</SaveButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
