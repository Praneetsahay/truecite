# TrueCite

Know what AI tells your customers about you, and fix what it gets wrong.

TrueCite asks ChatGPT, Gemini, Perplexity and Claude the questions customers ask about a company, checks every answer against the company's approved Fact Sheet, traces wrong answers to their likely sources, gives fix steps from a built-in playbook, and re-checks until the answers are right. The product plan is in [TC.md](TC.md).

## Run it

Requirements: Node.js 20.9 or later (22 recommended). No database server and no API keys are needed to try it.

```bash
npm install
npm run dev
```

Open http://localhost:3000. On first start the app creates an embedded Postgres database (PGlite) in `.data/pglite`, runs the migrations and loads demo data.

Demo accounts, all with the password `truecite`:

| Email | Who |
|---|---|
| priya@acme.example | Owner at Acme, the demo client |
| karan@acme.example | Member at Acme |
| neha@acme.example | Viewer at Acme (read-only) |
| vikram@proseware.example | Owner at Proseware, stopped halfway through onboarding |
| admin@truecite.example | TrueCite admin (review queue, scans, costs, prospects, settings) |

To start again with fresh demo data, stop the dev server and run `npm run db:reset`.

## API keys

Copy `.env.example` to `.env.local` and add the keys you have. Each AI platform uses its provider's official API with web search turned on where the provider offers it:

| Platform | Variable | Notes |
|---|---|---|
| ChatGPT | `OPENAI_API_KEY` | Responses API with the web search tool |
| Gemini | `GEMINI_API_KEY` | Gemini API with Google Search grounding |
| Perplexity | `PERPLEXITY_API_KEY` | Returns citations, which feed source tracing |
| Claude | `ANTHROPIC_API_KEY` | Official Anthropic SDK with web search. Also used for the checker, Fact Sheet drafting and question generation |

Without a key, a platform answers from a built-in simulator (when "Simulated answers" is on in Admin, Settings), and every simulated scan is labelled as such. Models and prices live in the database, not in code: change them in Admin, Settings. The default prices are estimates; confirm them on each provider's pricing page.

Email alerts go through Resend when `RESEND_API_KEY` is set. Otherwise every email is recorded in the outbox, which the Alerts page shows.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |
| `npm run db:generate` | Generate a migration after changing `src/lib/db/schema.ts` |
| `npm run db:migrate` | Apply migrations to `DATABASE_URL` (production Postgres) |
| `npm run db:reset` | Delete the local database; the next start reloads the demo data |
| `npm run shots -- [--as client\|admin] [--width 390] <path>` | Screenshots of the running app into `.shots/` |

## How it is built

- **Next.js 16 App Router** with Cache Components. Public pages are static. Everything under `/app` and `/admin` renders per request through a data access layer (`src/lib/auth/dal.ts`) that checks the session, the organization and the role before any data is read or changed.
- **Database**: Drizzle ORM over PGlite locally, or any Postgres (Supabase recommended) through `DATABASE_URL`. Schema in `src/lib/db/schema.ts`. Tenancy is enforced in the data access layer. For production, `supabase/rls.sql` adds row-level security as a second wall; it expects the server to connect as the `truecite_app` role and set `app.user_id` in each request's transaction, which is not wired into the data access layer yet.
- **Engine** (`src/lib/engine`): provider adapters behind one interface, a job queue (one job per question × platform × run, safe to run twice) with retries and backoff, the checker (statement extraction, verdicts, the consistency rule), issue creation and re-checks, source tracing, score snapshots, alerts, reports and PDF rendering. Locally the worker runs inside the Next.js server process. In production, run scheduled scans by calling `/api/cron/scans` with `Authorization: Bearer $CRON_SECRET`, and move the worker to a background service (Inngest, Trigger.dev or BullMQ) for long scans.
- **Design**: tokens in `src/app/globals.css` (paper, ink, graphite, correction red, verified green, highlighter), Schibsted Grotesk for the interface and Newsreader for AI answers and reports. Shared components in `src/components`. The proof view (`src/components/proof`) is the product's signature. See [AGENTS.md](AGENTS.md) for the conventions.

## What is not included yet

- Payment collection (Razorpay, Paddle or Stripe). Billing shows plans, invoices and plan change requests; invoices are issued by hand, as planned for the MVP.
- Google login, two-factor login, Slack, Teams and WhatsApp alerts, Hindi and Hinglish questions, and crisis mode: planned in the roadmap.
- The legal pages are drafts. Have a lawyer and a chartered accountant review them before you publish.
