import type { Metadata } from "next";
import { ActionButton } from "@/components/account/action-button";
import { TextLink } from "@/components/ui/button";
import { EmptyState, Notice, PageHeader, Section } from "@/components/ui/page";
import { RowHead, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireClient } from "@/lib/auth/dal";
import { ALERT_CHANNELS, ALERT_FREQUENCIES } from "@/lib/domain/constants";
import { formatDateTime, listJoin } from "@/lib/domain/format";
import { getAlertsPage } from "@/lib/queries/account";
import { cx } from "@/lib/cx";
import { deleteAlertRule, toggleAlertRule } from "./actions";
import { AlertRuleForm } from "./alert-rule-form";
import { MESSAGE_STATUS, thresholdLabel } from "./labels";

export const metadata: Metadata = { title: "Alerts" };

/** "Priya Nair, Karan Shah and 2 more" */
function recipientSummary(recipients: string[], names: Map<string, string>): string {
  const labels = recipients.map((address) => names.get(address.toLowerCase()) ?? address);
  if (labels.length <= 3) return listJoin(labels);
  return `${labels.slice(0, 2).join(", ")} and ${labels.length - 2} more`;
}

export default async function AlertsPage({ searchParams }: { searchParams: Promise<{ edit?: string; saved?: string }> }) {
  const ctx = await requireClient();
  const { edit, saved } = await searchParams;
  const { rules, messages, people } = await getAlertsPage(ctx.organization.id);
  const names = new Map(people.map((person) => [person.email.toLowerCase(), person.name]));
  const editing = ctx.isOwner && edit ? rules.find((rule) => rule.id === edit) : undefined;
  const anyRecorded = messages.some((message) => message.status === "logged");

  return (
    <>
      <PageHeader
        title="Alerts"
        description="Who hears about new wrong answers, and how soon. Send critical and high issues straight away, and the rest in a weekly digest."
      />

      {saved === "1" ? (
        <Notice tone="done" title="Rule saved." className="mb-8">
          The change applies to the next issue TrueCite finds.
        </Notice>
      ) : null}

      <Section
        id="rules"
        title="Alert rules"
        rule={false}
        description={ctx.isOwner ? undefined : "Only an owner can add or change alert rules."}
      >
        {rules.length === 0 ? (
          <EmptyState title="No alert rules yet.">
            {ctx.isOwner
              ? "Add a rule below so the right people hear about new critical issues straight away."
              : "Until an owner adds a rule, nobody gets an email when TrueCite finds a new issue."}
          </EmptyState>
        ) : (
          <Table className="relative" caption="Alert rules">
            <THead>
              <TR>
                <TH>Rule</TH>
                <TH>Channel</TH>
                <TH>Minimum severity</TH>
                <TH>When</TH>
                <TH>Recipients</TH>
                <TH>Status</TH>
                {ctx.isOwner ? (
                  <TH>
                    <span className="sr-only">Actions</span>
                  </TH>
                ) : null}
              </TR>
            </THead>
            <TBody>
              {rules.map((rule) => (
                <TR key={rule.id} className={cx(editing?.id === rule.id && "bg-wash")}>
                  <RowHead className="min-w-40 font-medium text-ink">{rule.name}</RowHead>
                  <TD className="whitespace-nowrap">
                    {ALERT_CHANNELS[rule.channel].label}
                    {ALERT_CHANNELS[rule.channel].available ? null : (
                      <span className="block text-sm text-graphite">Enterprise, planned</span>
                    )}
                  </TD>
                  <TD className="whitespace-nowrap">{thresholdLabel(rule.minimumSeverity)}</TD>
                  <TD className="whitespace-nowrap">{ALERT_FREQUENCIES[rule.frequency].label}</TD>
                  <TD className="min-w-48 text-graphite" title={rule.recipients.join(", ")}>
                    {rule.recipients.length > 0 ? recipientSummary(rule.recipients, names) : "Nobody yet"}
                  </TD>
                  <TD className="whitespace-nowrap">
                    {rule.active ? (
                      <span className="inline-flex items-center gap-2 text-ink">
                        <span aria-hidden="true" className="inline-block size-2 rounded-full bg-ink" />
                        On
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-2 text-graphite">
                        <span aria-hidden="true" className="inline-block size-2 rounded-full border border-graphite" />
                        Off
                      </span>
                    )}
                  </TD>
                  {ctx.isOwner ? (
                    <TD>
                      <div className="flex items-start justify-end gap-4 whitespace-nowrap">
                        <TextLink href={`/app/alerts?edit=${rule.id}#rule-form`} className="text-sm">
                          Edit<span className="sr-only"> {rule.name}</span>
                        </TextLink>
                        {ALERT_CHANNELS[rule.channel].available || rule.active ? (
                        <ActionButton
                          action={toggleAlertRule}
                          fields={{ id: rule.id, active: rule.active ? "false" : "true" }}
                          label={rule.active ? "Turn off" : "Turn on"}
                          target={rule.name}
                        />
                        ) : null}
                        <ActionButton
                          action={deleteAlertRule}
                          fields={{ id: rule.id }}
                          label="Delete"
                          target={rule.name}
                          confirm={{ question: "Delete this rule?", confirmLabel: "Delete" }}
                        />
                      </div>
                    </TD>
                  ) : null}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        {!ctx.isOwner ? (
          <p className="mt-4 text-sm text-graphite">
            Email is available on every plan. Slack, Microsoft Teams and WhatsApp alerts are planned for Enterprise.
          </p>
        ) : null}
      </Section>

      {ctx.isOwner ? (
        <Section
          id="rule-form"
          title={editing ? `Edit “${editing.name}”` : "Add a rule"}
          description={
            editing
              ? "Changes apply to the next issue TrueCite finds."
              : "A rule decides which new issues send an email, to whom, and how soon."
          }
        >
          <div className="max-w-2xl">
            <AlertRuleForm
              key={editing?.id ?? "new"}
              people={people.map((person) => ({ name: person.name, email: person.email }))}
              rule={
                editing
                  ? {
                      id: editing.id,
                      name: editing.name,
                      minimumSeverity: editing.minimumSeverity,
                      frequency: editing.frequency,
                      recipients: editing.recipients,
                      active: editing.active,
                    }
                  : undefined
              }
            />
          </div>
        </Section>
      ) : null}

      <Section
        id="sent"
        title="Sent recently"
        description={
          anyRecorded
            ? "Alerts, digests and other emails to your team, newest first. Recorded messages were saved here but not emailed, because email delivery is not set up yet."
            : "Alerts, digests and other emails to your team, newest first."
        }
      >
        {messages.length === 0 ? (
          <p className="text-graphite">
            Nothing sent yet. Alerts appear here when TrueCite confirms a new issue that matches a rule.
          </p>
        ) : (
          <Table className="relative" caption="Recent alerts and emails">
            <THead>
              <TR>
                <TH>Subject</TH>
                <TH>To</TH>
                <TH>Status</TH>
                <TH>Sent</TH>
              </TR>
            </THead>
            <TBody>
              {messages.map((message) => (
                <TR key={message.id}>
                  <RowHead className="min-w-56 text-ink">{message.subject}</RowHead>
                  <TD className="text-graphite">{names.get(message.recipient.toLowerCase()) ?? message.recipient}</TD>
                  <TD className="whitespace-nowrap" title={message.error ?? undefined}>
                    <span className={message.status === "failed" ? "font-medium text-ink" : "text-graphite"}>
                      {MESSAGE_STATUS[message.status]}
                    </span>
                  </TD>
                  <TD className="whitespace-nowrap text-graphite">{formatDateTime(message.createdAt)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Section>
    </>
  );
}

export const instant = false;
