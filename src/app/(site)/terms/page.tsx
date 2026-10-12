import type { Metadata } from "next";
import { LegalDocument } from "@/components/site-pages/legal-document";
import { TERMS } from "@/lib/content/legal";

export const metadata: Metadata = {
  title: TERMS.title,
  description: TERMS.description,
};

export default function TermsPage() {
  return <LegalDocument content={TERMS} path="/terms" />;
}
