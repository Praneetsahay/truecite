import type { Metadata } from "next";
import { LegalDocument } from "@/components/site-pages/legal-document";
import { REFUNDS } from "@/lib/content/legal";

export const metadata: Metadata = {
  title: REFUNDS.title,
  description: REFUNDS.description,
};

export default function RefundsPage() {
  return <LegalDocument content={REFUNDS} path="/refunds" />;
}
