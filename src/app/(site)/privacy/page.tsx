import type { Metadata } from "next";
import { LegalDocument } from "@/components/site-pages/legal-document";
import { PRIVACY } from "@/lib/content/legal";

export const metadata: Metadata = {
  title: PRIVACY.title,
  description: PRIVACY.description,
};

export default function PrivacyPage() {
  return <LegalDocument content={PRIVACY} path="/privacy" />;
}
