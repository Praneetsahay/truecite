"use client";

import { PendingButton, useFormAction } from "@/components/account/use-form-action";
import { TextLink } from "@/components/ui/button";
import { Choice, Field, Fieldset, FormMessage, Input, Select, Textarea } from "@/components/ui/field";
import { ALERT_CHANNELS, ALERT_FREQUENCIES, type AlertChannel, type AlertFrequency } from "@/lib/domain/constants";
import { saveAlertRule, type AlertRuleFormState, type AlertRuleValues } from "./actions";
import { SEVERITY_THRESHOLDS } from "./labels";

const FREQUENCY_HINTS: Record<AlertFrequency, string> = {
  instant: "One email for each new issue that matches, as soon as it is confirmed.",
  weekly: "One summary email a week with new and open issues that match.",
};

export type EditableRule = {
  id: string;
  name: string;
  minimumSeverity: string;
  frequency: string;
  recipients: string[];
  active: boolean;
};

export function AlertRuleForm({ people, rule }: { people: { name: string; email: string }[]; rule?: EditableRule }) {
  const { state, pending, onSubmit, formRef } = useFormAction(saveAlertRule);
  const errors = state.fieldErrors ?? {};
  const memberEmails = new Set(people.map((person) => person.email.toLowerCase()));

  const initial: AlertRuleValues = rule
    ? {
        name: rule.name,
        minimumSeverity: rule.minimumSeverity,
        frequency: rule.frequency,
        recipients: rule.recipients.filter((address) => memberEmails.has(address.toLowerCase())),
        otherRecipients: rule.recipients.filter((address) => !memberEmails.has(address.toLowerCase())).join(", "),
        active: rule.active,
      }
    : { name: "", minimumSeverity: "high", frequency: "instant", recipients: [], otherRecipients: "", active: true };
  const values = !state.ok && state.values ? state.values : initial;
  const chosen = new Set(values.recipients.map((address) => address.toLowerCase()));

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="grid gap-8">
      {rule ? <input type="hidden" name="id" value={rule.id} /> : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Rule name" htmlFor="rule-name" error={errors.name} className="sm:col-span-2">
          <Input
            id="rule-name"
            name="name"
            autoComplete="off"
            placeholder="Critical issues for legal"
            defaultValue={values.name}
            aria-invalid={Boolean(errors.name) || undefined}
            aria-describedby={errors.name ? "rule-name-error" : undefined}
          />
        </Field>
        <Field
          label="Minimum severity"
          htmlFor="rule-severity"
          hint="Issues at this severity and above trigger the rule."
          error={errors.minimumSeverity}
        >
          <Select
            id="rule-severity"
            name="minimumSeverity"
            defaultValue={values.minimumSeverity}
            aria-describedby="rule-severity-hint"
          >
            {SEVERITY_THRESHOLDS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Fieldset legend="When to send">
        <div className="grid gap-3">
          {(Object.keys(ALERT_FREQUENCIES) as AlertFrequency[]).map((frequency) => (
            <Choice
              key={frequency}
              type="radio"
              name="frequency"
              value={frequency}
              defaultChecked={values.frequency === frequency}
              label={ALERT_FREQUENCIES[frequency].label}
              description={FREQUENCY_HINTS[frequency]}
            />
          ))}
        </div>
        {errors.frequency ? <p className="text-sm text-correction">{errors.frequency}</p> : null}
      </Fieldset>

      <Fieldset legend="Channel">
        <div className="grid gap-3 sm:grid-cols-2">
          {(Object.keys(ALERT_CHANNELS) as AlertChannel[]).map((channel) => (
            <Choice
              key={channel}
              type="radio"
              name="channel"
              value={channel}
              defaultChecked={channel === "email"}
              disabled={!ALERT_CHANNELS[channel].available}
              label={ALERT_CHANNELS[channel].label}
              description={ALERT_CHANNELS[channel].available ? "Available on every plan" : "Enterprise, planned"}
            />
          ))}
        </div>
        {errors.channel ? <p className="text-sm text-correction">{errors.channel}</p> : null}
      </Fieldset>

      <Fieldset legend="Who receives these alerts" description="Choose people on your team, add other addresses, or both.">
        {people.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {people.map((person) => (
              <Choice
                key={person.email}
                name="recipients"
                value={person.email}
                defaultChecked={chosen.has(person.email.toLowerCase())}
                label={person.name}
                description={person.email}
              />
            ))}
          </div>
        ) : null}
        {errors.recipients ? <p className="text-sm text-correction">{errors.recipients}</p> : null}
        <Field
          label="Other email addresses"
          htmlFor="rule-others"
          optional
          hint="Separate addresses with commas or new lines, such as legal@acme.example."
          error={errors.otherRecipients}
        >
          <Textarea
            id="rule-others"
            name="otherRecipients"
            rows={2}
            className="min-h-16"
            defaultValue={values.otherRecipients}
            aria-invalid={Boolean(errors.otherRecipients) || undefined}
            aria-describedby={errors.otherRecipients ? "rule-others-error" : "rule-others-hint"}
          />
        </Field>
      </Fieldset>

      <Choice
        name="active"
        defaultChecked={values.active}
        label="Turn this rule on"
        description="A rule that is off sends nothing until you turn it on again."
      />

      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-rule pt-5">
        <PendingButton pending={pending}>{rule ? "Save rule" : "Add rule"}</PendingButton>
        {rule ? <TextLink href="/app/alerts">Cancel</TextLink> : null}
        <FormMessage state={state} />
      </div>
    </form>
  );
}
