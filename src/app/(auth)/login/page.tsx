import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Log in" };

/** Reads ?next= from the URL, so it renders at request time. */
export const instant = false;

const DEMO_ACCOUNTS = [
  { email: "priya@acme.example", role: "Acme, owner" },
  { email: "karan@acme.example", role: "Acme, member" },
  { email: "neha@acme.example", role: "Acme, viewer" },
  { email: "admin@truecite.example", role: "TrueCite admin" },
];

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-[-0.012em]">Log in to TrueCite</h1>
      <p className="mt-1.5 text-graphite">See what AI assistants tell your customers, and what to fix.</p>
      <div className="mt-8">
        <LoginForm next={typeof next === "string" ? next : undefined} />
      </div>
      <p className="mt-6 text-sm text-graphite">
        New to TrueCite?{" "}
        <Link href="/signup" className="text-ink underline decoration-rule-strong underline-offset-[3px] hover:decoration-ink">
          Create an account
        </Link>{" "}
        or{" "}
        <Link href="/free-check" className="text-ink underline decoration-rule-strong underline-offset-[3px] hover:decoration-ink">
          request a free check
        </Link>
        .
      </p>
      {process.env.NODE_ENV !== "production" ? (
        <div className="mt-10 border-t border-rule pt-5 text-sm text-graphite">
          <p className="font-medium text-ink">Demo accounts</p>
          <p className="mt-1">All use the password “truecite”.</p>
          <ul className="mt-3 grid gap-1">
            {DEMO_ACCOUNTS.map((account) => (
              <li key={account.email} className="flex justify-between gap-4">
                <span className="text-ink">{account.email}</span>
                <span>{account.role}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}
