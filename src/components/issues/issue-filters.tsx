import Form from "next/form";
import { Button, TextLink } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import {
  IMPORTANCE,
  PLATFORMS,
  QUESTION_CATEGORIES,
  SEVERITY_ORDER,
  type PlatformId,
  type QuestionCategory,
} from "@/lib/domain/constants";
import { issuesHref, type IssueFilters } from "@/lib/queries/issues";

/** Severity, platform and category filters. A plain GET form, so every filtered view has its own link. */
export function IssueFilterForm({
  filters,
  platforms,
  categories,
}: {
  filters: IssueFilters;
  platforms: PlatformId[];
  categories: QuestionCategory[];
}) {
  const active = Boolean(filters.severity || filters.platform || filters.category);
  return (
    <Form
      // Remount when the filters change, so the selects always show what the list shows.
      key={`${filters.severity}-${filters.platform}-${filters.category}`}
      action="/app/issues"
      className="grid gap-4 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-end lg:gap-x-4"
    >
      {filters.status !== "all" ? <input type="hidden" name="status" value={filters.status} /> : null}
      <Field label="Severity" htmlFor="filter-severity" className="lg:w-40">
        <Select id="filter-severity" name="severity" defaultValue={filters.severity ?? ""}>
          <option value="">Any severity</option>
          {SEVERITY_ORDER.map((id) => (
            <option key={id} value={id}>
              {IMPORTANCE[id].label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="AI platform" htmlFor="filter-platform" className="lg:w-40">
        <Select id="filter-platform" name="platform" defaultValue={filters.platform ?? ""}>
          <option value="">Any platform</option>
          {platforms.map((id) => (
            <option key={id} value={id}>
              {PLATFORMS[id].name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Question category" htmlFor="filter-category" className="sm:col-span-2 lg:w-60">
        <Select id="filter-category" name="category" defaultValue={filters.category ?? ""}>
          <option value="">Any category</option>
          {categories.map((id) => (
            <option key={id} value={id}>
              {QUESTION_CATEGORIES[id].label}
            </option>
          ))}
        </Select>
      </Field>
      <div className="flex items-center gap-5 sm:col-span-2 lg:h-9">
        <Button type="submit">Apply</Button>
        {active ? <TextLink href={issuesHref({ status: filters.status })}>Clear filters</TextLink> : null}
      </div>
    </Form>
  );
}
