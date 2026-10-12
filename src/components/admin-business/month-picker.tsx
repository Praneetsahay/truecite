import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { formatMonth } from "@/lib/domain/format";

/** A plain GET form: works without JavaScript and keeps the month in the URL. */
export function MonthPicker({ months, month, action }: { months: string[]; month: string; action: string }) {
  return (
    <form method="get" action={action} className="flex items-end gap-2">
      <div className="grid w-44 gap-1.5">
        <label htmlFor="month" className="text-sm text-graphite">
          Month
        </label>
        <Select id="month" name="month" defaultValue={month}>
          {months.map((m) => (
            <option key={m} value={m}>
              {formatMonth(`${m}-01`).replace(/ /g, " ")}
            </option>
          ))}
        </Select>
      </div>
      <Button type="submit">Show</Button>
    </form>
  );
}
