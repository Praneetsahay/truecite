-- Row-level security for TrueCite on Supabase or any Postgres.
--
-- The app enforces tenancy in its data access layer (src/lib/auth/dal.ts). These
-- policies add a second wall so that one client can never read another client's
-- data, even if application code has a bug.
--
-- How it works: the server connects as the role truecite_app (not the table
-- owner, so policies apply) and, inside each request's transaction, runs
--   select set_config('app.user_id', '<signed-in user id>', true);
-- Admin tooling and background jobs connect as truecite_worker, which bypasses
-- RLS and must only run trusted server code.
--
-- Apply after the drizzle migrations:  psql "$DATABASE_URL" -f supabase/rls.sql

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'truecite_app') then
    create role truecite_app nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'truecite_worker') then
    create role truecite_worker nologin bypassrls;
  end if;
end $$;

grant usage on schema public to truecite_app, truecite_worker;
grant select, insert, update, delete on all tables in schema public to truecite_app, truecite_worker;

-- The signed-in user, set per transaction by the server.
create or replace function app_user_id() returns uuid
  language sql stable
  as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;

-- Organizations the signed-in user belongs to.
create or replace function app_org_ids() returns setof uuid
  language sql stable security definer set search_path = public
  as $$ select organization_id from memberships where user_id = app_user_id() $$;

-- Brands of those organizations.
create or replace function app_brand_ids() returns setof uuid
  language sql stable security definer set search_path = public
  as $$ select id from brands where organization_id in (select app_org_ids()) $$;

-- Tables keyed by organization.
do $$
declare t text;
begin
  foreach t in array array['memberships', 'invites', 'brands', 'alert_rules', 'outbox', 'subscriptions', 'invoices', 'usage_costs', 'audit_log']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists tenant_rows on %I', t);
    execute format('create policy tenant_rows on %I to truecite_app using (organization_id in (select app_org_ids())) with check (organization_id in (select app_org_ids()))', t);
  end loop;
end $$;

alter table organizations enable row level security;
drop policy if exists tenant_rows on organizations;
create policy tenant_rows on organizations to truecite_app
  using (id in (select app_org_ids()));

-- Tables keyed by brand.
do $$
declare t text;
begin
  foreach t in array array['competitors', 'facts', 'questions', 'scans', 'answers', 'statements', 'issues', 'reports', 'score_snapshots', 'competitor_snapshots']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists tenant_rows on %I', t);
    execute format('create policy tenant_rows on %I to truecite_app using (brand_id in (select app_brand_ids())) with check (brand_id in (select app_brand_ids()))', t);
  end loop;
end $$;

-- Tables reached through a parent row.
alter table scan_jobs enable row level security;
drop policy if exists tenant_rows on scan_jobs;
create policy tenant_rows on scan_jobs to truecite_app
  using (scan_id in (select id from scans where brand_id in (select app_brand_ids())));

alter table citations enable row level security;
drop policy if exists tenant_rows on citations;
create policy tenant_rows on citations to truecite_app
  using (answer_id in (select id from answers where brand_id in (select app_brand_ids())));

alter table issue_events enable row level security;
drop policy if exists tenant_rows on issue_events;
create policy tenant_rows on issue_events to truecite_app
  using (issue_id in (select id from issues where brand_id in (select app_brand_ids())))
  with check (issue_id in (select id from issues where brand_id in (select app_brand_ids())));

alter table sources enable row level security;
drop policy if exists tenant_rows on sources;
create policy tenant_rows on sources to truecite_app
  using (issue_id in (select id from issues where brand_id in (select app_brand_ids())));

-- People: a user sees themselves and the members of their organizations.
alter table users enable row level security;
drop policy if exists tenant_rows on users;
create policy tenant_rows on users to truecite_app
  using (id = app_user_id() or id in (select user_id from memberships where organization_id in (select app_org_ids())));

alter table sessions enable row level security;
drop policy if exists tenant_rows on sessions;
create policy tenant_rows on sessions to truecite_app
  using (user_id = app_user_id());

-- Internal tables: only the worker role (and admins through it) may touch these.
do $$
declare t text;
begin
  foreach t in array array['prospects', 'check_requests', 'settings']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
-- The public free check form inserts requests without a session.
drop policy if exists public_insert on check_requests;
create policy public_insert on check_requests to truecite_app for insert with check (true);
