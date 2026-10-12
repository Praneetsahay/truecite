import type { Metadata } from "next";
import { ProspectForm } from "@/components/admin-business/prospect-forms";
import { PageHeader } from "@/components/ui/page";
import { requireAdmin } from "@/lib/auth/dal";
import { addProspect } from "../actions";

// Checks the admin session on every request, like the rest of /admin.
export const instant = false;

export const metadata: Metadata = { title: "Add prospect" };

export default async function NewProspectPage() {
  await requireAdmin();
  return (
    <>
      <PageHeader
        crumbs={[{ label: "Prospects", href: "/admin/prospects" }, { label: "Add prospect" }]}
        title="Add prospect"
        description="A company you want to reach. After you add it, run a prospect scan and review the findings before anything is sent."
      />
      <div className="border-t border-rule pt-6">
        <ProspectForm action={addProspect} />
      </div>
    </>
  );
}
