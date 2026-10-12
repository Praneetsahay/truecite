import "server-only";
import { getDb, outbox } from "@/lib/db";

/*
  Sends through Resend when RESEND_API_KEY is set; otherwise records the message
  in the outbox table with status "logged". Every message lands in the outbox
  either way, so admins can see what was sent. A delivery failure never throws:
  it is recorded and returned as a status.
*/

const RESEND_TIMEOUT_MS = 15_000;

async function deliver(input: { to: string; subject: string; body: string }): Promise<{ status: "sent" | "logged" | "failed"; error: string | null }> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return { status: "logged", error: null };
  const from = process.env.EMAIL_FROM?.trim();
  if (!from) return { status: "failed", error: "EMAIL_FROM is not set. Add a sender address verified in Resend." };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RESEND_TIMEOUT_MS);
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ from, to: [input.to], subject: input.subject, text: input.body }),
      signal: controller.signal,
    });
    if (response.ok) return { status: "sent", error: null };
    const detail = await response.text().catch(() => "");
    let message = detail;
    try {
      const parsed = JSON.parse(detail) as { message?: string };
      if (parsed.message) message = parsed.message;
    } catch {
      // keep the raw text
    }
    return { status: "failed", error: `Resend returned HTTP ${response.status}${message ? `: ${message.slice(0, 300)}` : ""}` };
  } catch (error) {
    const message = controller.signal.aborted ? `timed out after ${RESEND_TIMEOUT_MS / 1000} s` : error instanceof Error ? error.message : String(error);
    return { status: "failed", error: `Could not reach Resend: ${message}` };
  } finally {
    clearTimeout(timer);
  }
}

export async function sendEmail(input: {
  organizationId: string | null;
  to: string;
  subject: string;
  body: string;
}): Promise<{ status: "sent" | "logged" | "failed" }> {
  const to = input.to.trim();
  const result = to.includes("@")
    ? await deliver({ to, subject: input.subject, body: input.body })
    : { status: "failed" as const, error: `"${to}" is not an email address.` };
  if (result.status === "failed") console.warn(`[engine] email to ${to} failed: ${result.error}`);

  const db = await getDb();
  await db.insert(outbox).values({
    organizationId: input.organizationId,
    channel: "email",
    recipient: to,
    subject: input.subject,
    body: input.body,
    status: result.status,
    error: result.error,
  });
  return { status: result.status };
}
