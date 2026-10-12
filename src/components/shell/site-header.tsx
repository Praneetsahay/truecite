import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { MobileMenu } from "./mobile-menu";
import { Wordmark } from "./wordmark";

const links = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/pricing", label: "Pricing" },
  { href: "/sample-report", label: "Sample report" },
];

export function SiteHeader() {
  return (
    <header className="relative border-b border-rule">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-4 sm:px-6 lg:px-8">
        <Wordmark />
        <nav aria-label="Main" className="hidden items-center gap-7 md:flex">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className="text-base text-graphite transition-colors hover:text-ink">
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="hidden items-center gap-5 md:flex">
          <Link href="/login" className="text-base text-graphite transition-colors hover:text-ink">
            Log in
          </Link>
          <ButtonLink href="/free-check" variant="primary">
            Request a free check
          </ButtonLink>
        </div>
        <MobileMenu className="md:hidden">
          <nav aria-label="Main" className="grid gap-1">
            {links.map((link) => (
              <Link key={link.href} href={link.href} className="py-2 text-lg text-ink">
                {link.label}
              </Link>
            ))}
            <Link href="/login" className="py-2 text-lg text-ink">
              Log in
            </Link>
            <ButtonLink href="/free-check" variant="primary" className="mt-3">
              Request a free check
            </ButtonLink>
          </nav>
        </MobileMenu>
      </div>
    </header>
  );
}
