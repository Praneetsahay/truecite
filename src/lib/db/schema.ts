import { relations } from "drizzle-orm";
import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  AlertChannel,
  AlertFrequency,
  CheckRequestStatus,
  Currency,
  ErrorVerdict,
  FactCategory,
  FactStatus,
  Importance,
  InvoiceStatus,
  IssueOrigin,
  IssueStatus,
  JobStatus,
  LanguageId,
  MarketId,
  OnboardingStep,
  PlanId,
  PlatformId,
  ProspectStatus,
  QuestionCategory,
  ReportType,
  ReviewState,
  Role,
  ScanFrequency,
  ScanStatus,
  ScanType,
  Severity,
  SourceLikelihood,
  SourceType,
  SubscriptionStatus,
  Verdict,
} from "@/lib/domain/constants";
import type { ErrorType } from "@/lib/domain/playbook";
import type { ReportData } from "@/lib/domain/report";

/*
  The TrueCite data model. Every table that holds client data links to an
  organization (directly or through a brand). In production on Supabase, row-level
  security in supabase/rls.sql enforces that separation; locally the data access
  layer scopes every query.
*/

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const ts = (name: string) => timestamp(name, { withTimezone: true });
const day = (name: string) => date(name, { mode: "string" });

export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  plan: text("plan").$type<PlanId>().notNull().default("trial"),
  country: text("country").$type<MarketId>().notNull().default("IN"),
  currency: text("currency").$type<Currency>().notNull().default("INR"),
  /** Internal accounts (such as the one that owns prospect brands) never appear as clients. */
  internal: boolean("internal").notNull().default(false),
  createdAt: createdAt(),
});

export const users = pgTable("users", {
  id: id(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  title: text("title"),
  isAdmin: boolean("is_admin").notNull().default(false),
  twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
  lastLoginAt: ts("last_login_at"),
  createdAt: createdAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    /** SHA-256 of the session token; the token itself only lives in the cookie. */
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Admin support: the organization being viewed as a client. Every use is logged. */
    viewAsOrganizationId: uuid("view_as_organization_id").references(() => organizations.id, {
      onDelete: "set null",
    }),
    expiresAt: ts("expires_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    role: text("role").$type<Role>().notNull().default("member"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("memberships_user_org_idx").on(t.userId, t.organizationId)],
);

export const invites = pgTable("invites", {
  id: id(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role").$type<Role>().notNull().default("member"),
  invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
  tokenHash: text("token_hash").notNull(),
  acceptedAt: ts("accepted_at"),
  createdAt: createdAt(),
});

export const brands = pgTable(
  "brands",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    website: text("website").notNull(),
    description: text("description"),
    industry: text("industry"),
    markets: jsonb("markets").$type<MarketId[]>().notNull().default([]),
    languages: jsonb("languages").$type<LanguageId[]>().notNull().default(["en"]),
    platforms: jsonb("platforms").$type<PlatformId[]>().notNull().default(["chatgpt", "perplexity"]),
    scanFrequency: text("scan_frequency").$type<ScanFrequency>().notNull().default("biweekly"),
    runsPerQuestion: integer("runs_per_question").notNull().default(2),
    onboardingStep: text("onboarding_step").$type<OnboardingStep>().notNull().default("company"),
    nextScanAt: ts("next_scan_at"),
    createdAt: createdAt(),
  },
  (t) => [index("brands_org_idx").on(t.organizationId)],
);

export const competitors = pgTable("competitors", {
  id: id(),
  brandId: uuid("brand_id")
    .notNull()
    .references(() => brands.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  website: text("website").notNull(),
  createdAt: createdAt(),
});

export const facts = pgTable(
  "facts",
  {
    id: id(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    category: text("category").$type<FactCategory>().notNull(),
    statement: text("statement").notNull(),
    importance: text("importance").$type<Importance>().notNull().default("medium"),
    sourceUrl: text("source_url"),
    /** YYYY-MM-DD. A fact with a past valid_to is a former fact, used to label outdated answers. */
    validFrom: day("valid_from"),
    validTo: day("valid_to"),
    status: text("status").$type<FactStatus>().notNull().default("draft"),
    origin: text("origin").$type<"website" | "manual">().notNull().default("website"),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: ts("approved_at"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").defaultNow().notNull(),
  },
  (t) => [index("facts_brand_idx").on(t.brandId)],
);

export const questions = pgTable(
  "questions",
  {
    id: id(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    category: text("category").$type<QuestionCategory>().notNull(),
    language: text("language").$type<LanguageId>().notNull().default("en"),
    /** Key questions are checked on every scan; standard ones can be checked less often. */
    priority: text("priority").$type<"key" | "standard">().notNull().default("standard"),
    active: boolean("active").notNull().default(true),
    origin: text("origin").$type<"generated" | "custom">().notNull().default("generated"),
    createdAt: createdAt(),
  },
  (t) => [index("questions_brand_idx").on(t.brandId)],
);

export const scans = pgTable(
  "scans",
  {
    id: id(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    type: text("type").$type<ScanType>().notNull(),
    status: text("status").$type<ScanStatus>().notNull().default("queued"),
    platforms: jsonb("platforms").$type<PlatformId[]>().notNull(),
    runsPerQuestion: integer("runs_per_question").notNull(),
    questionCount: integer("question_count").notNull().default(0),
    jobsTotal: integer("jobs_total").notNull().default(0),
    jobsDone: integer("jobs_done").notNull().default(0),
    jobsFailed: integer("jobs_failed").notNull().default(0),
    totalCostUsd: doublePrecision("total_cost_usd").notNull().default(0),
    /** True when answers came from the built-in simulator because no API key was set. */
    simulated: boolean("simulated").notNull().default(false),
    /** For re-checks: the issue being re-checked. */
    issueId: uuid("issue_id"),
    triggeredBy: uuid("triggered_by").references(() => users.id, { onDelete: "set null" }),
    note: text("note"),
    error: text("error"),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
    createdAt: createdAt(),
  },
  (t) => [index("scans_brand_idx").on(t.brandId), index("scans_status_idx").on(t.status)],
);

export const scanJobs = pgTable(
  "scan_jobs",
  {
    id: id(),
    scanId: uuid("scan_id")
      .notNull()
      .references(() => scans.id, { onDelete: "cascade" }),
    questionId: uuid("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    platform: text("platform").$type<PlatformId>().notNull(),
    runNumber: integer("run_number").notNull(),
    status: text("status").$type<JobStatus>().notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    nextAttemptAt: ts("next_attempt_at"),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
    createdAt: createdAt(),
  },
  (t) => [
    // One job per question × platform × run makes every job safe to run twice.
    uniqueIndex("scan_jobs_unique_idx").on(t.scanId, t.questionId, t.platform, t.runNumber),
    index("scan_jobs_status_idx").on(t.status),
  ],
);

export const answers = pgTable(
  "answers",
  {
    id: id(),
    scanId: uuid("scan_id")
      .notNull()
      .references(() => scans.id, { onDelete: "cascade" }),
    questionId: uuid("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    platform: text("platform").$type<PlatformId>().notNull(),
    model: text("model").notNull(),
    runNumber: integer("run_number").notNull(),
    text: text("text").notNull(),
    /** The full provider response, kept so old answers can be re-checked without paying again. */
    rawResponse: jsonb("raw_response"),
    settings: jsonb("settings").$type<{ webSearch: boolean; [key: string]: unknown }>().notNull(),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    searchCalls: integer("search_calls").notNull().default(0),
    costUsd: doublePrecision("cost_usd").notNull().default(0),
    latencyMs: integer("latency_ms"),
    simulated: boolean("simulated").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("answers_unique_idx").on(t.scanId, t.questionId, t.platform, t.runNumber),
    index("answers_brand_idx").on(t.brandId),
    index("answers_question_idx").on(t.questionId),
  ],
);

export const citations = pgTable(
  "citations",
  {
    id: id(),
    answerId: uuid("answer_id")
      .notNull()
      .references(() => answers.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    title: text("title"),
    position: integer("position").notNull(),
  },
  (t) => [index("citations_answer_idx").on(t.answerId)],
);

export const statements = pgTable(
  "statements",
  {
    id: id(),
    answerId: uuid("answer_id")
      .notNull()
      .references(() => answers.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    /** The claim as written in the answer. */
    text: text("text").notNull(),
    /** Grouping key used by the consistency rule. */
    claimKey: text("claim_key").notNull(),
    factId: uuid("fact_id").references(() => facts.id, { onDelete: "set null" }),
    verdict: text("verdict").$type<Verdict>().notNull(),
    confidence: doublePrecision("confidence").notNull().default(1),
    /** Character offsets of the claim inside answers.text, used to draw the correction mark. */
    spanStart: integer("span_start"),
    spanEnd: integer("span_end"),
    issueId: uuid("issue_id"),
    /** Logged and watched: seen only once, so not an issue yet. */
    intermittent: boolean("intermittent").notNull().default(false),
    sentiment: text("sentiment").$type<"positive" | "neutral" | "negative">(),
    createdAt: createdAt(),
  },
  (t) => [
    index("statements_answer_idx").on(t.answerId),
    index("statements_issue_idx").on(t.issueId),
    index("statements_brand_idx").on(t.brandId),
  ],
);

export const issues = pgTable(
  "issues",
  {
    id: id(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    /** Per-brand number shown to people and used in URLs: /app/issues/101 */
    number: integer("number").notNull(),
    title: text("title").notNull(),
    type: text("type").$type<ErrorType>().notNull(),
    verdict: text("verdict").$type<ErrorVerdict>().notNull(),
    severity: text("severity").$type<Severity>().notNull(),
    status: text("status").$type<IssueStatus>().notNull().default("open"),
    /** Early on, every issue is reviewed by an admin before the client sees it. */
    reviewState: text("review_state").$type<ReviewState>().notNull().default("pending"),
    reviewNote: text("review_note"),
    wrongStatement: text("wrong_statement").notNull(),
    correctStatement: text("correct_statement").notNull(),
    factId: uuid("fact_id").references(() => facts.id, { onDelete: "set null" }),
    questionId: uuid("question_id").references(() => questions.id, { onDelete: "set null" }),
    category: text("category").$type<QuestionCategory>(),
    platforms: jsonb("platforms").$type<PlatformId[]>().notNull().default([]),
    origin: text("origin").$type<IssueOrigin>().notNull().default("web"),
    confidence: doublePrecision("confidence").notNull().default(1),
    /** Seen in N of M runs in the latest scan that saw it. */
    runsSeen: integer("runs_seen").notNull().default(0),
    runsTotal: integer("runs_total").notNull().default(0),
    firstSeenAt: ts("first_seen_at").notNull(),
    lastSeenAt: ts("last_seen_at").notNull(),
    resolvedAt: ts("resolved_at"),
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    cleanScanStreak: integer("clean_scan_streak").notNull().default(0),
    nextCheckAt: ts("next_check_at"),
    /** Indexes of Fix Playbook steps the team has ticked off. */
    fixProgress: jsonb("fix_progress").$type<number[]>().notNull().default([]),
    /** "Not an error": dismissed by the client, fed back into the checker's rules. */
    dismissedAt: ts("dismissed_at"),
    dismissedBy: uuid("dismissed_by").references(() => users.id, { onDelete: "set null" }),
    dismissNote: text("dismiss_note"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("issues_brand_number_idx").on(t.brandId, t.number),
    index("issues_brand_status_idx").on(t.brandId, t.status),
    index("issues_review_idx").on(t.reviewState),
  ],
);

export const issueEvents = pgTable(
  "issue_events",
  {
    id: id(),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    kind: text("kind")
      .$type<
        | "detected"
        | "approved"
        | "rejected"
        | "status"
        | "assigned"
        | "note"
        | "seen"
        | "clean"
        | "recheck"
        | "not_an_error"
        | "reopened"
        | "resolved"
        | "severity"
        | "fix_step"
      >()
      .notNull(),
    fromStatus: text("from_status").$type<IssueStatus>(),
    toStatus: text("to_status").$type<IssueStatus>(),
    /** Null for TrueCite itself. */
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    /** Kept even if the user is later removed, for the evidence trail. */
    actorName: text("actor_name").notNull(),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("issue_events_issue_idx").on(t.issueId)],
);

export const sources = pgTable(
  "sources",
  {
    id: id(),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    title: text("title"),
    domain: text("domain").notNull(),
    sourceType: text("source_type").$type<SourceType>().notNull().default("other"),
    containsStatement: boolean("contains_statement").notNull().default(false),
    likelihood: text("likelihood").$type<SourceLikelihood>().notNull().default("possible"),
    /** "2023", "Mar 2024" */
    publishedLabel: text("published_label"),
    /** "Still live", "Redirected 14 Oct" */
    note: text("note"),
    citedBy: jsonb("cited_by").$type<PlatformId[]>().notNull().default([]),
    checkedAt: ts("checked_at"),
  },
  (t) => [index("sources_issue_idx").on(t.issueId)],
);

export const reports = pgTable(
  "reports",
  {
    id: id(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    type: text("type").$type<ReportType>().notNull(),
    title: text("title").notNull(),
    /** "2026-09" for monthly reports. */
    period: text("period"),
    status: text("status").$type<"draft" | "ready" | "sent">().notNull().default("ready"),
    data: jsonb("data").$type<ReportData>().notNull(),
    shareToken: text("share_token").unique(),
    shareExpiresAt: ts("share_expires_at"),
    createdAt: createdAt(),
  },
  (t) => [index("reports_brand_idx").on(t.brandId)],
);

export const alertRules = pgTable("alert_rules", {
  id: id(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  channel: text("channel").$type<AlertChannel>().notNull().default("email"),
  minimumSeverity: text("minimum_severity").$type<Severity>().notNull().default("high"),
  frequency: text("frequency").$type<AlertFrequency>().notNull().default("instant"),
  recipients: jsonb("recipients").$type<string[]>().notNull().default([]),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

/** Every alert or email TrueCite sends, or would send when no email provider is configured. */
export const outbox = pgTable("outbox", {
  id: id(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  channel: text("channel").$type<AlertChannel>().notNull().default("email"),
  recipient: text("recipient").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  status: text("status").$type<"sent" | "logged" | "failed">().notNull(),
  error: text("error"),
  createdAt: createdAt(),
});

export const subscriptions = pgTable("subscriptions", {
  id: id(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  provider: text("provider").$type<"manual" | "razorpay" | "paddle" | "stripe">().notNull().default("manual"),
  plan: text("plan").$type<PlanId>().notNull(),
  status: text("status").$type<SubscriptionStatus>().notNull(),
  amount: doublePrecision("amount").notNull(),
  currency: text("currency").$type<Currency>().notNull(),
  interval: text("interval").$type<"month" | "year">().notNull().default("month"),
  founding: boolean("founding").notNull().default(false),
  priceLockedUntil: day("price_locked_until"),
  renewsAt: day("renews_at"),
  createdAt: createdAt(),
});

export const invoices = pgTable("invoices", {
  id: id(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  number: text("number").notNull().unique(),
  description: text("description").notNull(),
  amount: doublePrecision("amount").notNull(),
  tax: doublePrecision("tax").notNull().default(0),
  currency: text("currency").$type<Currency>().notNull(),
  status: text("status").$type<InvoiceStatus>().notNull(),
  issuedOn: day("issued_on").notNull(),
  dueOn: day("due_on").notNull(),
  paidOn: day("paid_on"),
});

export const usageCosts = pgTable(
  "usage_costs",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "set null" }),
    scanId: uuid("scan_id").references(() => scans.id, { onDelete: "set null" }),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    purpose: text("purpose").$type<"answer" | "check" | "trace" | "facts" | "questions">().notNull(),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    searchCalls: integer("search_calls").notNull().default(0),
    costUsd: doublePrecision("cost_usd").notNull().default(0),
    /** YYYY-MM-DD */
    day: day("day").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("usage_costs_org_day_idx").on(t.organizationId, t.day)],
);

export const prospects = pgTable("prospects", {
  id: id(),
  company: text("company").notNull(),
  website: text("website").notNull(),
  industry: text("industry"),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  contactRole: text("contact_role"),
  /** The internal brand used to run the prospect scan. */
  brandId: uuid("brand_id").references(() => brands.id, { onDelete: "set null" }),
  reportId: uuid("report_id").references(() => reports.id, { onDelete: "set null" }),
  status: text("status").$type<ProspectStatus>().notNull().default("new"),
  source: text("source").$type<"outbound" | "free_check">().notNull().default("outbound"),
  notes: text("notes"),
  createdAt: createdAt(),
  updatedAt: ts("updated_at").defaultNow().notNull(),
});

/** Requests from the public free check form. They wait for a person instead of running automatically. */
export const checkRequests = pgTable("check_requests", {
  id: id(),
  company: text("company").notNull(),
  website: text("website").notNull(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  role: text("role"),
  message: text("message"),
  status: text("status").$type<CheckRequestStatus>().notNull().default("new"),
  prospectId: uuid("prospect_id").references(() => prospects.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

/** Models, prices and feature switches live here, not in code. */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: ts("updated_at").defaultNow().notNull(),
});

export type PlatformBreakdown = Partial<Record<PlatformId, { score: number | null; checked: number; openIssues: number }>>;
export type CategoryBreakdown = Partial<Record<QuestionCategory, { score: number | null; checked: number; openIssues: number }>>;
export type SentimentSplit = { positive: number; neutral: number; negative: number };

export const scoreSnapshots = pgTable(
  "score_snapshots",
  {
    id: id(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    scanId: uuid("scan_id").references(() => scans.id, { onDelete: "set null" }),
    takenAt: ts("taken_at").notNull(),
    accuracyScore: doublePrecision("accuracy_score"),
    statementsChecked: integer("statements_checked").notNull().default(0),
    openCritical: integer("open_critical").notNull().default(0),
    openHigh: integer("open_high").notNull().default(0),
    openTotal: integer("open_total").notNull().default(0),
    byPlatform: jsonb("by_platform").$type<PlatformBreakdown>().notNull().default({}),
    byCategory: jsonb("by_category").$type<CategoryBreakdown>().notNull().default({}),
    sentiment: jsonb("sentiment").$type<SentimentSplit>(),
    shareOfVoice: doublePrecision("share_of_voice"),
  },
  (t) => [index("score_snapshots_brand_idx").on(t.brandId, t.takenAt)],
);

export const competitorSnapshots = pgTable(
  "competitor_snapshots",
  {
    id: id(),
    competitorId: uuid("competitor_id")
      .notNull()
      .references(() => competitors.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    scanId: uuid("scan_id").references(() => scans.id, { onDelete: "set null" }),
    takenAt: ts("taken_at").notNull(),
    /** An estimate: competitor Fact Sheets are drafted from public pages without confirmation. */
    accuracyScore: doublePrecision("accuracy_score"),
    sentiment: jsonb("sentiment").$type<SentimentSplit>(),
    shareOfVoice: doublePrecision("share_of_voice"),
  },
  (t) => [index("competitor_snapshots_brand_idx").on(t.brandId, t.takenAt)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    actorName: text("actor_name").notNull(),
    action: text("action").notNull(),
    target: text("target"),
    detail: jsonb("detail"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_log_org_idx").on(t.organizationId, t.createdAt)],
);

/* Relations, for db.query.<table>.findMany({ with: ... }) */

export const organizationsRelations = relations(organizations, ({ many }) => ({
  memberships: many(memberships),
  brands: many(brands),
  subscriptions: many(subscriptions),
  invoices: many(invoices),
  alertRules: many(alertRules),
}));

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(memberships),
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  user: one(users, { fields: [memberships.userId], references: [users.id] }),
  organization: one(organizations, { fields: [memberships.organizationId], references: [organizations.id] }),
}));

export const brandsRelations = relations(brands, ({ one, many }) => ({
  organization: one(organizations, { fields: [brands.organizationId], references: [organizations.id] }),
  competitors: many(competitors),
  facts: many(facts),
  questions: many(questions),
  issues: many(issues),
  scans: many(scans),
  reports: many(reports),
}));

export const competitorsRelations = relations(competitors, ({ one, many }) => ({
  brand: one(brands, { fields: [competitors.brandId], references: [brands.id] }),
  snapshots: many(competitorSnapshots),
}));

export const factsRelations = relations(facts, ({ one }) => ({
  brand: one(brands, { fields: [facts.brandId], references: [brands.id] }),
}));

export const questionsRelations = relations(questions, ({ one, many }) => ({
  brand: one(brands, { fields: [questions.brandId], references: [brands.id] }),
  answers: many(answers),
}));

export const scansRelations = relations(scans, ({ one, many }) => ({
  brand: one(brands, { fields: [scans.brandId], references: [brands.id] }),
  jobs: many(scanJobs),
  answers: many(answers),
}));

export const scanJobsRelations = relations(scanJobs, ({ one }) => ({
  scan: one(scans, { fields: [scanJobs.scanId], references: [scans.id] }),
  question: one(questions, { fields: [scanJobs.questionId], references: [questions.id] }),
}));

export const answersRelations = relations(answers, ({ one, many }) => ({
  scan: one(scans, { fields: [answers.scanId], references: [scans.id] }),
  question: one(questions, { fields: [answers.questionId], references: [questions.id] }),
  citations: many(citations),
  statements: many(statements),
}));

export const citationsRelations = relations(citations, ({ one }) => ({
  answer: one(answers, { fields: [citations.answerId], references: [answers.id] }),
}));

export const statementsRelations = relations(statements, ({ one }) => ({
  answer: one(answers, { fields: [statements.answerId], references: [answers.id] }),
  fact: one(facts, { fields: [statements.factId], references: [facts.id] }),
  issue: one(issues, { fields: [statements.issueId], references: [issues.id] }),
}));

export const issuesRelations = relations(issues, ({ one, many }) => ({
  brand: one(brands, { fields: [issues.brandId], references: [brands.id] }),
  fact: one(facts, { fields: [issues.factId], references: [facts.id] }),
  question: one(questions, { fields: [issues.questionId], references: [questions.id] }),
  assignee: one(users, { fields: [issues.assigneeId], references: [users.id] }),
  events: many(issueEvents),
  sources: many(sources),
  statements: many(statements),
}));

export const issueEventsRelations = relations(issueEvents, ({ one }) => ({
  issue: one(issues, { fields: [issueEvents.issueId], references: [issues.id] }),
}));

export const sourcesRelations = relations(sources, ({ one }) => ({
  issue: one(issues, { fields: [sources.issueId], references: [issues.id] }),
}));

export const reportsRelations = relations(reports, ({ one }) => ({
  brand: one(brands, { fields: [reports.brandId], references: [brands.id] }),
}));

export const competitorSnapshotsRelations = relations(competitorSnapshots, ({ one }) => ({
  competitor: one(competitors, { fields: [competitorSnapshots.competitorId], references: [competitors.id] }),
}));

export const prospectsRelations = relations(prospects, ({ one }) => ({
  brand: one(brands, { fields: [prospects.brandId], references: [brands.id] }),
  report: one(reports, { fields: [prospects.reportId], references: [reports.id] }),
}));

export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
  organization: one(organizations, { fields: [subscriptions.organizationId], references: [organizations.id] }),
}));

export const invoicesRelations = relations(invoices, ({ one }) => ({
  organization: one(organizations, { fields: [invoices.organizationId], references: [organizations.id] }),
}));

export const alertRulesRelations = relations(alertRules, ({ one }) => ({
  organization: one(organizations, { fields: [alertRules.organizationId], references: [organizations.id] }),
}));

export type Organization = typeof organizations.$inferSelect;
export type User = typeof users.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type Brand = typeof brands.$inferSelect;
export type Competitor = typeof competitors.$inferSelect;
export type Fact = typeof facts.$inferSelect;
export type Question = typeof questions.$inferSelect;
export type Scan = typeof scans.$inferSelect;
export type ScanJob = typeof scanJobs.$inferSelect;
export type Answer = typeof answers.$inferSelect;
export type Citation = typeof citations.$inferSelect;
export type Statement = typeof statements.$inferSelect;
export type Issue = typeof issues.$inferSelect;
export type IssueEvent = typeof issueEvents.$inferSelect;
export type Source = typeof sources.$inferSelect;
export type Report = typeof reports.$inferSelect;
export type AlertRule = typeof alertRules.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type UsageCost = typeof usageCosts.$inferSelect;
export type Prospect = typeof prospects.$inferSelect;
export type CheckRequest = typeof checkRequests.$inferSelect;
export type ScoreSnapshot = typeof scoreSnapshots.$inferSelect;
export type CompetitorSnapshot = typeof competitorSnapshots.$inferSelect;
