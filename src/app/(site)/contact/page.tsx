import type { Metadata } from "next";
import Link from "next/link";
import { PageIntro, SectionHeading, SiteSection } from "@/components/site-pages/site-page";
import { COMPANY } from "@/lib/content/company";

export const metadata: Metadata = {
  title: "Contact",
  description: "How to reach TrueCite about sales, support, billing and privacy.",
};

const linkClass = "text-ink underline decoration-rule-strong underline-offset-[3px] hover:decoration-ink";


const TOPICS = [
  {
    topic: "A free check or an audit",
    how: (
      <>
        Use the{" "}
        <Link href="/free-check" className={linkClass}>
          free check form
        </Link>
        , or email us with your company and website.
      </>
    ),
  },
  {
    topic: "Help with your account",
    how: <>Email us from the address you sign in with, and name the page you were on.</>,
  },
  {
    topic: "Invoices, GST and refunds",
    how: (
      <>
        Include your company name and invoice number. The{" "}
        <Link href="/refunds" className={linkClass}>
          refund policy
        </Link>{" "}
        explains what applies.
      </>
    ),
  },
  {
    topic: "Your personal data",
    how: (
      <>
        Write “Privacy request” in the subject. We reply within 30 days, as the{" "}
        <Link href="/privacy" className={linkClass}>
          Privacy Policy
        </Link>{" "}
        describes.
      </>
    ),
  },
];

export default function ContactPage() {
  return (
    <>
      <PageIntro kicker="Sales, support, billing and privacy" title="Contact TrueCite">
        <p>
          Every message is read and answered by a person, usually the same person who reviews the findings in your
          reports.
        </p>
      </PageIntro>

      <SiteSection split labelledBy="write-to-us">
        <SectionHeading title="Write to us" id="write-to-us">
          <p>
            One address for sales, support, billing and privacy. We reply within {COMPANY.replyTime}, {COMPANY.supportHours}.
          </p>
        </SectionHeading>
        <div>
          <dl className="border-t border-rule-strong">
            <div className="grid gap-1 border-b border-rule py-4 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-6">
              <dt className="text-graphite">Email</dt>
              <dd>
                <a href={`mailto:${COMPANY.email}`} className={`${linkClass} text-xl font-medium break-all`}>
                  {COMPANY.email}
                </a>
              </dd>
            </div>
            <div className="grid gap-1 border-b border-rule py-4 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-6">
              <dt className="text-graphite">Hours</dt>
              <dd className="text-ink">{COMPANY.supportHours}</dd>
            </div>
            <div className="grid gap-1 border-b border-rule py-4 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-6">
              <dt className="text-graphite">Registered business address</dt>
              <dd className="text-ink">
                {COMPANY.registeredAddress ? (
                  <address className="not-italic whitespace-pre-line">{COMPANY.registeredAddress}</address>
                ) : (
                  <span className="highlight">Placeholder: the registered business address will be added here.</span>
                )}
              </dd>
            </div>
          </dl>
        </div>
      </SiteSection>

      <SiteSection split last labelledBy="what-to-include">
        <SectionHeading title="What to include" id="what-to-include">
          <p>A little context lets us answer in one reply instead of three.</p>
        </SectionHeading>
        <dl className="border-t border-rule-strong">
          {TOPICS.map((item) => (
            <div key={item.topic} className="grid gap-1 border-b border-rule py-4 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-6">
              <dt className="font-medium text-ink">{item.topic}</dt>
              <dd className="text-ink">{item.how}</dd>
            </div>
          ))}
        </dl>
      </SiteSection>
    </>
  );
}
