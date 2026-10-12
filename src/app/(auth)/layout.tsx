import Link from "next/link";
import { Wordmark } from "@/components/shell/wordmark";

/** Sign up and log in: the wordmark and one narrow column, nothing else. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Wordmark />
        <Link href="/" className="text-sm text-graphite hover:text-ink">
          Back to the website
        </Link>
      </header>
      <main id="main" className="flex flex-1 justify-center px-4 pt-10 pb-20 sm:pt-16">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
