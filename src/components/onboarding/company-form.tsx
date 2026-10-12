"use client";

import { useRef, useState } from "react";
import type { ActionState } from "@/lib/actions";
import { LANGUAGES, MARKETS, type LanguageId, type MarketId } from "@/lib/domain/constants";
import { plural } from "@/lib/domain/format";
import { Button } from "@/components/ui/button";
import { Choice, Field, Fieldset, Input } from "@/components/ui/field";
import { useFormAction } from "./use-form-action";

type CompetitorRow = { key: string; id: string | null; name: string; website: string };

export type CompanyValues = {
  name: string;
  website: string;
  industry: string;
  markets: MarketId[];
  competitors: { id: string; name: string; website: string }[];
};

function invalid(error: string | undefined, id: string) {
  return { "aria-invalid": Boolean(error) || undefined, "aria-describedby": error ? `${id}-error` : undefined } as const;
}

/** Step 1. Every field is controlled, so nothing typed is lost when the server returns an error. */
export function CompanyForm({
  initial,
  competitorLimit,
  planLabel,
  readOnly,
  action,
}: {
  initial: CompanyValues;
  competitorLimit: number;
  planLabel: string;
  readOnly: boolean;
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  const { state, pending, onSubmit } = useFormAction(action);
  const errors = state.fieldErrors ?? {};
  const [name, setName] = useState(initial.name);
  const [website, setWebsite] = useState(initial.website);
  const [industry, setIndustry] = useState(initial.industry);
  const [markets, setMarkets] = useState<MarketId[]>(initial.markets);
  const nextKey = useRef(0);
  const newRow = (): CompetitorRow => ({ key: `new-${nextKey.current++}`, id: null, name: "", website: "" });
  const [rows, setRows] = useState<CompetitorRow[]>(() =>
    initial.competitors.length > 0
      ? initial.competitors.map((c) => ({ key: c.id, id: c.id, name: c.name, website: c.website }))
      : [{ key: "new-first", id: null, name: "", website: "" }],
  );
  const atLimit = rows.length >= competitorLimit;

  function updateRow(key: string, patch: Partial<CompetitorRow>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-12" noValidate>
      <fieldset disabled={readOnly} className="grid gap-12">
        <Fieldset legend="Company" description="The company AI assistants should describe correctly.">
          <div className="grid gap-5 sm:max-w-md">
            <Field label="Company name" htmlFor="name" error={errors.name}>
              <Input id="name" name="name" autoComplete="organization" value={name} onChange={(e) => setName(e.target.value)} {...invalid(errors.name, "name")} />
            </Field>
            <Field
              label="Website"
              htmlFor="website"
              hint="TrueCite reads its public pages to draft your Fact Sheet in the next step."
              error={errors.website}
            >
              <Input
                id="website"
                name="website"
                inputMode="url"
                autoComplete="url"
                placeholder="acme.com"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                {...invalid(errors.website, "website")}
              />
            </Field>
            <Field
              label="What the company does"
              htmlFor="industry"
              optional
              hint="For example, payroll and HR software. It helps TrueCite ask questions the way your customers do."
              error={errors.industry}
            >
              <Input id="industry" name="industry" value={industry} onChange={(e) => setIndustry(e.target.value)} {...invalid(errors.industry, "industry")} />
            </Field>
          </div>
        </Fieldset>

        <Fieldset
          legend="Competitors"
          description={`TrueCite asks the same questions about them, so you can compare scores. The ${planLabel} plan includes ${plural(competitorLimit, "competitor")}.`}
        >
          <div className="grid gap-3">
            <div aria-hidden="true" className="hidden gap-3 text-sm text-graphite sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_5rem]">
              <span>Name</span>
              <span>Website</span>
            </div>
            {rows.map((row, index) => {
              const nameError = errors[`competitor-${index}-name`];
              const siteError = errors[`competitor-${index}-website`];
              const nameId = `competitor-${index}-name`;
              const siteId = `competitor-${index}-website`;
              return (
                <div key={row.key} className="grid gap-2 border-b border-rule pb-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_5rem] sm:gap-3 sm:border-b-0 sm:pb-0">
                  <input type="hidden" name="competitorId" value={row.id ?? ""} />
                  <div className="grid gap-1">
                    <label htmlFor={nameId} className="sr-only">
                      Competitor {index + 1} name
                    </label>
                    <Input
                      id={nameId}
                      name="competitorName"
                      placeholder="Name"
                      value={row.name}
                      onChange={(e) => updateRow(row.key, { name: e.target.value })}
                      {...invalid(nameError, nameId)}
                    />
                    {nameError ? (
                      <p id={`${nameId}-error`} className="text-sm text-correction">
                        {nameError}
                      </p>
                    ) : null}
                  </div>
                  <div className="grid gap-1">
                    <label htmlFor={siteId} className="sr-only">
                      Competitor {index + 1} website
                    </label>
                    <Input
                      id={siteId}
                      name="competitorWebsite"
                      inputMode="url"
                      placeholder="Website"
                      value={row.website}
                      onChange={(e) => updateRow(row.key, { website: e.target.value })}
                      {...invalid(siteError, siteId)}
                    />
                    {siteError ? (
                      <p id={`${siteId}-error`} className="text-sm text-correction">
                        {siteError}
                      </p>
                    ) : null}
                  </div>
                  <div className="sm:h-9 sm:content-center">
                    <Button
                      variant="quiet"
                      size="sm"
                      onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}
                      aria-label={`Remove competitor ${index + 1}${row.name ? `, ${row.name}` : ""}`}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              );
            })}
            {rows.length === 0 ? <p className="text-sm text-graphite">No competitors. You can add them later on the Competitors page.</p> : null}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
              <Button size="sm" onClick={() => setRows((current) => [...current, newRow()])} disabled={atLimit}>
                Add a competitor
              </Button>
              {atLimit ? (
                <span className="text-sm text-graphite">That is the most your plan includes.</span>
              ) : null}
            </div>
          </div>
        </Fieldset>

        <Fieldset legend="Markets" description="Where your customers are. Questions mention these countries where it matters.">
          <div className="grid gap-3 sm:grid-cols-2">
            {(Object.keys(MARKETS) as MarketId[]).map((id) => (
              <Choice
                key={id}
                name="markets"
                value={id}
                label={MARKETS[id].label}
                checked={markets.includes(id)}
                onChange={(e) =>
                  setMarkets((current) => (e.target.checked ? [...current, id] : current.filter((m) => m !== id)))
                }
              />
            ))}
          </div>
          {errors.markets ? <p className="text-sm text-correction">{errors.markets}</p> : null}
        </Fieldset>

        <Fieldset legend="Languages" description="The language TrueCite asks questions in.">
          <div className="grid gap-3 sm:grid-cols-2">
            {(Object.keys(LANGUAGES) as LanguageId[]).map((id) => (
              <Choice
                key={id}
                label={LANGUAGES[id].label}
                description={LANGUAGES[id].available ? "Always on" : "Planned"}
                checked={id === "en"}
                // English is always on and stays readable; planned languages are shown but unavailable.
                onChange={() => {}}
                aria-readonly={LANGUAGES[id].available || undefined}
                disabled={!LANGUAGES[id].available}
              />
            ))}
          </div>
        </Fieldset>
      </fieldset>

      <div className="grid gap-3 border-t border-rule pt-6">
        {state.message && !state.ok ? (
          <p role="alert" className="text-sm text-correction">
            {state.message}
          </p>
        ) : null}
        <div>
          <Button type="submit" variant="primary" disabled={readOnly || pending} aria-busy={pending || undefined}>
            Save and continue
          </Button>
        </div>
      </div>
    </form>
  );
}
