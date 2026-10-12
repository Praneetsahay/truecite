import type { Metadata } from "next";
import { SourceGroupTable } from "@/components/content/source-groups";
import { TextLink } from "@/components/ui/button";
import { EmptyState, Notice, PageHeader } from "@/components/ui/page";
import { requireClient } from "@/lib/auth/dal";
import { plural } from "@/lib/domain/format";
import { getSourceGroups } from "@/lib/queries/content";

export const metadata: Metadata = { title: "Sources" };

export default async function SourcesPage() {
  const ctx = await requireClient();
  const groups = await getSourceGroups(ctx);

  const own = groups.filter((group) => group.sourceType === "own_site");
  const ownPages = own.flatMap((group) => group.pages.filter((page) => page.containsStatement));
  const pageCount = groups.reduce((sum, group) => sum + group.pages.length, 0);

  return (
    <>
      <PageHeader
        title="Sources"
        description={
          <>
            A source is a web page an AI assistant cited, or most likely read, when it gave a wrong answer. TrueCite
            fetches each page and checks whether it contains the wrong statement. Pages on your own website are the
            fastest to fix.
          </>
        }
      />

      {groups.length === 0 ? (
        <EmptyState title="No sources found yet.">
          When an AI assistant cites pages in a wrong answer, TrueCite checks them and lists them here, grouped by
          website. Errors with no citations come from AI memory and are explained on each{" "}
          <TextLink href="/app/issues">issue</TextLink>.
        </EmptyState>
      ) : (
        <>
          {ownPages.length > 0 ? (
            <Notice
              tone="attention"
              title={`${plural(ownPages.length, "page")} on your own website ${ownPages.length === 1 ? "contains" : "contain"} a wrong statement`}
              className="mb-8"
              action={
                <TextLink href={`#site-${own[0].domain.replace(/[^a-z0-9]+/gi, "-")}`} className="text-sm text-ink">
                  See {ownPages.length === 1 ? "it" : "them"}
                </TextLink>
              }
            >
              Start there: you can update or redirect {ownPages.length === 1 ? "it" : "them"} today, and AI assistants that
              search the web often pick up the change within days or weeks.
            </Notice>
          ) : null}

          <p className="mb-4 text-sm text-graphite">
            {plural(pageCount, "page")} on {plural(groups.length, "website")}, the ones that feed the most open issues
            first. Open a website to see its pages.
          </p>
          <SourceGroupTable groups={groups} />
        </>
      )}
    </>
  );
}
