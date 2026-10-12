<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# TrueCite: how this codebase works

TrueCite shows PR, brand and legal teams what AI assistants say about their company, what is wrong, where it came from and how to fix it. `TC.md` is the product plan; its "Design direction" section is binding.

## Stack

- Next.js 16.4 App Router with `cacheComponents` and `partialPrefetching` on, React 19.3, TypeScript, Tailwind CSS 4.
- Drizzle ORM. Locally the database is PGlite (embedded Postgres in `.data/pglite`, created and seeded with demo data on first start). `DATABASE_URL` switches to a real Postgres such as Supabase. Schema: `src/lib/db/schema.ts`; migrations in `drizzle/` (`npm run db:generate`). Only one process may open the PGlite directory at a time.
- No UI kit, icon pack, chart library or date library. Components are in `src/components`, built on the design tokens.

## Rendering rules (Cache Components)

- Public pages under `src/app/(site)` are static. They must not read cookies, headers, searchParams or the database, and must never call `new Date()`, `Date.now()` or `Math.random()` in server components (that fails the build). A public page that needs request data exports `export const instant = false` and calls `await requestNow()` from `@/lib/auth/dal` before reading the database.
- Everything under `/app` and `/admin` renders per request: their layouts export `instant = false`, and each page file must export `export const instant = false` too (without it, development logs "uncached data during prerendering or a navigation" errors). Every page and every Server Action goes through the data access layer in `src/lib/auth/dal.ts`:
  - client pages: `const ctx = await requireClient()` (onboarding uses `getClientContext()`)
  - client actions that change data: `requireEditor()`; team, billing and alert settings: `requireOwner()`
  - admin pages and actions: `requireAdmin()`
  Use `ctx.now` instead of creating dates in server components. Scope every query by `ctx.brand.id` or `ctx.organization.id`, and use `sameBrand(record, ctx)` before showing or changing a record looked up by id.
- `params` and `searchParams` are Promises: `const { number } = await params`.
- Mutations are Server Actions in an `actions.ts` with `"use server"` next to the route. Validate input with zod and return `ActionState` from `@/lib/actions` (`{ ok, message, fieldErrors }`) for `useActionState`; `actionError(error)` turns permission and engine errors into messages. Then call `refresh()` from `next/cache` (or `revalidatePath`) or `redirect()`. `redirect()` works by throwing: call it after the try/catch, or call `unstable_rethrow(error)` from `next/navigation` first inside catch blocks.
- Every change to an issue writes an `issue_events` row with `actorId` and `actorName`: it is the evidence trail legal teams rely on.
- AI, scans, reports and email go through `@/lib/engine` (never the internal engine modules).

## Design rules

- Colors are tokens with one job each: `paper` page background, `sheet` documents and inputs, `ink` text, `graphite` secondary text, `rule`/`rule-strong` hairlines, `wash` hover and selection, `correction` incorrect statements only (and form errors), `verified` correct statements and resolved issues only, `highlighter` needs review or seen only sometimes. Tailwind's default palette, shadows and large radii are removed on purpose. Never use arbitrary colors such as `bg-[#123456]`.
- Color is never the only signal: a wrong statement is struck through and labelled, severity has bars and a word, status has a shape and a word.
- Type: Schibsted Grotesk (`font-sans`) for the interface, numbers and tables; Newsreader (`font-serif`) for quoted AI answers, report prose and the occasional editorial line on public pages. Scale: `text-sm` 13 meta, `text-md` 14 tables, `text-base` 15 interface, `text-lg` 17, `text-xl` 20, `text-2xl` 24 page titles, `text-3xl`–`text-5xl` figures and the landing headline. Use the `figures` class only for numbers in table columns: in this face tabular figures space out commas and periods, so never use it on standalone prices, large figures with separators, or numbered headings. `cx()` joins classes without merging, so a `className` passed to a shared component cannot override a class the component already sets.
- Sentence case everywhere. No all-caps or letter-spaced labels, no emoji, no exclamation marks, no decorative icons, no gradients, no shadows, no grids of identical cards, no stock illustrations, no fake logos, testimonials or metrics.
- Calm layouts: plain tables, generous spacing, hairline rules, left-aligned text. One primary button per screen.
- The proof view is the signature: `ProofAnswer`, `AnswerSheet`, `MarginNote`, `SourceList` in `src/components/proof`. Wrong statement struck through in red, correct fact in the margin, footnote numbers to sources. The strike-through draws once on the landing page and nowhere else.
- Words come from the client's point of view: "Wrong answers", "Fixed", "Re-checking", "Resolved". An action keeps its name through the flow ("Re-check now" leads to "Re-check started"). Errors say what happened and what to do next, without apologizing. Empty screens invite action and say what happens next.
- Accessibility: every control has a label, tables use `th` with scope (the `Table` components do), focus is always visible, reduced motion is respected, and every page works at 390 px wide without horizontal page scrolling (wide tables scroll inside `Table`).

## Shared building blocks (reuse, don't fork)

- `components/ui/button.tsx` Button, ButtonLink, TextLink, ExternalLink; `submit-button.tsx` SubmitButton
- `components/ui/field.tsx` Field, Input, Textarea, Select, Choice, Fieldset, FormMessage
- `components/ui/table.tsx` Table, THead, TBody, TR, TH, TD, RowHead
- `components/ui/page.tsx` PageHeader (title, description, actions, crumbs, aside), Section, EmptyState, Notice, Details, Meta, FilterLinks
- `components/ui/marks.tsx` SeverityMark, StatusMark, VerdictLabel, ReviewLabel, PlatformList, EstimateMark
- `components/ui/score.tsx` ScoreFigure, Delta, CountFigure
- `components/charts` TrendChart, Meter, SentimentBar
- `components/report/report-document.tsx` ReportDocument (renders `ReportData`)
- `lib/domain/*` constants and labels, score, consistency rule, severity, Fix Playbook, issue workflow, costs and margin rule, formatting (`formatDate`, `formatMoney`, `displayUrl`, `listJoin`, `plural`)

## Checking your work

- `npx tsc --noEmit`
- When rewriting files from PowerShell, always pass `-Encoding utf8` to `Get-Content` and `Set-Content`; without it ₹, · and × are corrupted. Prefer the editor tools.
- React 19 resets a `<form action>` after the action finishes, which clears what was typed when validation fails. For forms that can fail, submit through `onSubmit` + `startTransition` (see `src/components/admin-business/action-form.tsx`).
- The dev server runs at http://localhost:3000. Do not start another one and do not run `next build` while it runs.
- `node scripts/shot.mjs [--as client|member|viewer|admin] [--width 390] [--slices] <path> ...` saves screenshots to `.shots/` and prints errors. Read the PNGs to see the result.
- Demo accounts (password `truecite`): priya@acme.example (owner), karan@acme.example (member), neha@acme.example (viewer), admin@truecite.example (admin).
