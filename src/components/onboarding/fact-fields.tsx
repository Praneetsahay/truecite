"use client";

import { FACT_CATEGORIES, FACT_CATEGORY_IDS, IMPORTANCE, SEVERITY_ORDER, type FactCategory, type Importance } from "@/lib/domain/constants";
import { Field, Input, Select, Textarea } from "@/components/ui/field";

export type FactValues = {
  category: FactCategory;
  statement: string;
  importance: Importance;
  validFrom: string | null;
  sourceUrl: string | null;
};

function invalid(error: string | undefined, id: string) {
  return { "aria-invalid": Boolean(error) || undefined, "aria-describedby": error ? `${id}-error` : undefined } as const;
}

/** The fields of one fact, shared by "Add a fact" and Edit. `prefix` keeps ids unique on the page. */
export function FactFields({
  prefix,
  values,
  errors,
}: {
  prefix: string;
  values?: Partial<FactValues>;
  errors: Partial<Record<string, string>>;
}) {
  const id = (name: string) => `${prefix}-${name}`;
  return (
    <div className="grid gap-4">
      <Field
        label="Fact"
        htmlFor={id("statement")}
        hint="One public fact per entry, written as a full sentence."
        error={errors.statement}
      >
        <Textarea
          id={id("statement")}
          name="statement"
          rows={2}
          className="min-h-16"
          defaultValue={values?.statement ?? ""}
          placeholder="The Basic plan costs $79 per month."
          {...invalid(errors.statement, id("statement"))}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Category" htmlFor={id("category")} error={errors.category}>
          <Select id={id("category")} name="category" defaultValue={values?.category ?? "company"}>
            {FACT_CATEGORY_IDS.map((category) => (
              <option key={category} value={category}>
                {FACT_CATEGORIES[category].label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Importance" htmlFor={id("importance")} error={errors.importance}>
          <Select id={id("importance")} name="importance" defaultValue={values?.importance ?? "medium"}>
            {SEVERITY_ORDER.map((level) => (
              <option key={level} value={level}>
                {IMPORTANCE[level].label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Valid from" htmlFor={id("validFrom")} optional error={errors.validFrom}>
          <Input id={id("validFrom")} name="validFrom" type="date" defaultValue={values?.validFrom ?? ""} {...invalid(errors.validFrom, id("validFrom"))} />
        </Field>
      </div>
      <Field label="Source page" htmlFor={id("sourceUrl")} optional error={errors.sourceUrl}>
        <Input
          id={id("sourceUrl")}
          name="sourceUrl"
          inputMode="url"
          placeholder="acme.com/pricing"
          defaultValue={values?.sourceUrl ?? ""}
          {...invalid(errors.sourceUrl, id("sourceUrl"))}
        />
      </Field>
    </div>
  );
}
