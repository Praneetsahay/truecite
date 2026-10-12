import type { Metadata } from "next";
import { SettingsForm } from "@/components/admin-business/settings-form";
import { EmptyState, PageHeader, Section } from "@/components/ui/page";
import { RowHead, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth/dal";
import { formatDateTime, formatRelative } from "@/lib/domain/format";
import { getSettings, providerStatus } from "@/lib/engine";
import { getAuditLog } from "@/lib/queries/admin-business";
import { saveSettings } from "./actions";

// Checks the admin session on every request, like the rest of /admin.
export const instant = false;

export const metadata: Metadata = { title: "Settings" };

const KEY_ROWS = [
  { key: "openai", name: "OpenAI", used: "ChatGPT answers", missing: "Not set, answers are simulated" },
  { key: "google", name: "Google Gemini", used: "Gemini answers", missing: "Not set, answers are simulated" },
  { key: "perplexity", name: "Perplexity", used: "Perplexity answers", missing: "Not set, answers are simulated" },
  { key: "anthropic", name: "Anthropic", used: "Claude answers and the checker", missing: "Not set, answers are simulated" },
  { key: "email", name: "Resend", used: "Alert and digest emails", missing: "Not set, emails are logged, not sent" },
] as const;

export default async function SettingsPage() {
  const ctx = await requireAdmin();
  const [settings, audit] = await Promise.all([getSettings(), getAuditLog(50)]);
  const keys = providerStatus();

  return (
    <>
      <PageHeader
        title="Settings"
        description="Models, prices and feature switches for every scan. Changes apply to new requests straight away and are recorded in the audit log."
      />

      <SettingsForm action={saveSettings} settings={settings} />

      <Section
        className="mt-14"
        title="Provider keys"
        description="Keys live in environment variables on the server and are never shown here. Set them in the hosting dashboard, then restart the app."
      >
        <Table caption="Provider key status">
          <THead>
            <tr>
              <TH>Provider</TH>
              <TH>Used for</TH>
              <TH>Environment variable</TH>
              <TH>Status</TH>
            </tr>
          </THead>
          <TBody>
            {KEY_ROWS.map((row) => {
              const status = keys[row.key];
              return (
                <TR key={row.key}>
                  <RowHead className="font-medium text-ink">{row.name}</RowHead>
                  <TD className="min-w-44 text-graphite">{row.used}</TD>
                  <TD>
                    <code className="text-sm">{status.envVar}</code>
                  </TD>
                  <TD className="min-w-48">
                    {status.configured ? (
                      <span className="text-ink">Set</span>
                    ) : (
                      <span className="text-graphite">
                        {row.key !== "email" && !settings.features.simulateWithoutKeys
                          ? "Not set, these requests fail"
                          : row.missing}
                      </span>
                    )}
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </Section>

      <Section title="Audit log" description="The latest 50 admin actions across TrueCite, newest first.">
        {audit.length === 0 ? (
          <EmptyState title="Nothing recorded yet." className="border-t-0 pt-0">
            Settings changes, retries, reviews and support views are recorded here as they happen.
          </EmptyState>
        ) : (
          <Table caption="Audit log">
            <THead>
              <tr>
                <TH>When</TH>
                <TH>Who</TH>
                <TH>What</TH>
                <TH>Account</TH>
              </tr>
            </THead>
            <TBody>
              {audit.map((row) => (
                <TR key={row.id}>
                  <TD className="whitespace-nowrap">
                    <span title={formatDateTime(row.createdAt)}>{formatRelative(row.createdAt, ctx.now)}</span>
                    <span className="mt-0.5 block text-sm text-graphite">{formatDateTime(row.createdAt)}</span>
                  </TD>
                  <TD className="whitespace-nowrap">{row.actorName}</TD>
                  <TD className="min-w-64">{row.action}</TD>
                  <TD className="min-w-32 text-graphite">{row.organizationName ?? "TrueCite"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Section>
    </>
  );
}
