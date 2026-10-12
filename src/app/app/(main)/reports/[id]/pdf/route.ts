import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { getClientContext } from "@/lib/auth/dal";
import { getDb, reports } from "@/lib/db";
import { EngineNotReadyError, renderReportPdf } from "@/lib/engine";
import { isUuid } from "@/lib/queries/account";

/*
  Downloads a report as a PDF. The engine prints the report's print view with a
  local Chrome or Edge, signed in with the same cookies as this request. When no
  browser is available, the print view opens instead and asks the browser to print.
*/

function fileName(brand: string, title: string): string {
  const slug = `${brand} ${title}`
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug || "truecite-report"}.pdf`;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getClientContext();
  if (!isUuid(id)) return new Response("Report not found.", { status: 404 });

  const db = await getDb();
  const [report] = await db
    .select({ id: reports.id, title: reports.title })
    .from(reports)
    .where(and(eq(reports.id, id), eq(reports.brandId, ctx.brand.id)))
    .limit(1);
  if (!report) return new Response("Report not found.", { status: 404 });

  let pdf: Uint8Array | null = null;
  try {
    pdf = await renderReportPdf({
      url: `${request.nextUrl.origin}/print/reports/${report.id}`,
      cookieHeader: request.headers.get("cookie") ?? undefined,
    });
  } catch (error) {
    // No PDF renderer: fall back to the browser's own print dialog below.
    if (!(error instanceof EngineNotReadyError)) console.error(error);
    pdf = null;
  }

  if (!pdf) redirect(`/print/reports/${report.id}?print=1`);

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName(ctx.brand.name, report.title)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
