import Link from "next/link";
import { Wordmark } from "@/components/shell/wordmark";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col px-4 py-6 sm:px-6">
      <Wordmark />
      <main id="main" className="flex flex-1 flex-col justify-center pb-24">
        <p className="text-sm text-graphite">Page not found</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-0.012em]">This page does not exist, or you do not have access to it.</h1>
        <p className="mt-3 text-graphite">Check the address, or go back to where you started.</p>
        <div className="mt-6 flex gap-5 text-base">
          <Link href="/" className="underline decoration-rule-strong underline-offset-[3px] hover:decoration-ink">
            Go to the home page
          </Link>
          <Link href="/app/dashboard" className="underline decoration-rule-strong underline-offset-[3px] hover:decoration-ink">
            Go to your dashboard
          </Link>
        </div>
      </main>
    </div>
  );
}
