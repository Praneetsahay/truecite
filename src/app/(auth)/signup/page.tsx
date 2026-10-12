import type { Metadata } from "next";
import Link from "next/link";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Create an account" };

export default function SignupPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-[-0.012em]">Create your TrueCite account</h1>
      <p className="mt-1.5 text-graphite">Setup takes about ten minutes. Your first scan starts at the end.</p>
      <div className="mt-8">
        <SignupForm />
      </div>
      <p className="mt-6 text-sm text-graphite">
        Already have an account?{" "}
        <Link href="/login" className="text-ink underline decoration-rule-strong underline-offset-[3px] hover:decoration-ink">
          Log in
        </Link>
        .
      </p>
    </>
  );
}
