-- Ordo – database for sync across devices (Supabase). Run this file in the SQL editor of your own project
-- (or with psql against a self-hosted Supabase), followed by supabase/own-project.sql – the app's setup
-- "Eigene Datenbank" copies both in one go. Running it again is safe. See SELFHOST.md.
-- The server only ever stores ciphertext: the sealed vault file and AES-GCM encrypted attachment blobs.
-- Tables are prefixed with summa_ (the name of the accounting module) so they can live next to other apps.

create table if not exists public.summa_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('admin', 'user')) default 'user',
  created_at timestamptz not null default now()
);

-- Two-factor sign-in (see below): true when the session passed the code, or the account has no authenticator.
create or replace function public.summa_mfa_ok() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2'
      or not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified');
$$;
revoke all on function public.summa_mfa_ok() from public, anon;
grant execute on function public.summa_mfa_ok() to authenticated;

-- Admin rights need the second factor too when the admin has turned it on.
create or replace function public.summa_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.summa_roles r where r.user_id = auth.uid() and r.role = 'admin') and public.summa_mfa_ok();
$$;
revoke all on function public.summa_is_admin() from public, anon;
grant execute on function public.summa_is_admin() to authenticated;

create table if not exists public.summa_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text,
  plan text not null default 'free' check (plan in ('free', 'pro', 'family')),
  disabled boolean not null default false,
  note text,
  app_version text,
  platform text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.summa_vault_meta (
  user_id uuid primary key references auth.users (id) on delete cascade,
  revision bigint not null default 0,
  device_id text,
  vault_bytes bigint not null default 0,
  blob_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.summa_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  description text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);


create table if not exists public.summa_sync_log (
  id bigserial primary key,
  user_id uuid references auth.users (id) on delete cascade,
  device_id text,
  action text not null,
  revision bigint,
  bytes bigint,
  ok boolean not null default true,
  message text,
  created_at timestamptz not null default now()
);
create index if not exists summa_sync_log_user_idx on public.summa_sync_log (user_id, created_at desc);

create or replace function public.summa_touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end $$;
revoke all on function public.summa_touch_updated_at() from public, anon, authenticated;
drop trigger if exists summa_users_touch on public.summa_users;
create trigger summa_users_touch before update on public.summa_users for each row execute function public.summa_touch_updated_at();
drop trigger if exists summa_vault_meta_touch on public.summa_vault_meta;
create trigger summa_vault_meta_touch before update on public.summa_vault_meta for each row execute function public.summa_touch_updated_at();
-- Live sync: other devices of the same account hear about a save right away (Supabase Realtime, row-level
-- security applies, only the own row is visible). Projects without Realtime simply keep the timer.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'summa_vault_meta') then
    alter publication supabase_realtime add table public.summa_vault_meta;
  end if;
end $$;
drop trigger if exists summa_settings_touch on public.summa_settings;
create trigger summa_settings_touch before update on public.summa_settings for each row execute function public.summa_touch_updated_at();

-- Ordo modules this account may use, overriding summa_settings.module_access (e.g. {"produktion": false}).
alter table public.summa_users add column if not exists modules jsonb not null default '{}'::jsonb;

create or replace function public.summa_users_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- admins and the edge functions (service role) may set plan/disabled/note/billing ids; users only touch their own profile fields
  if not (public.summa_is_admin() or auth.role() = 'service_role') then
    if tg_op = 'UPDATE' then
      new.plan := old.plan; new.disabled := old.disabled; new.note := old.note;
      new.modules := old.modules;
    else
      new.plan := 'free'; new.disabled := false; new.note := null;
      new.modules := '{}'::jsonb;
    end if;
    -- the profile e-mail is never user-chosen: it mirrors the verified auth e-mail
    new.email := (select u.email from auth.users u where u.id = new.user_id);
  end if;
  return new;
end $$;
revoke all on function public.summa_users_guard() from public, anon, authenticated;
drop trigger if exists summa_users_guard_trg on public.summa_users;
create trigger summa_users_guard_trg before insert or update on public.summa_users for each row execute function public.summa_users_guard();

alter table public.summa_roles enable row level security;
alter table public.summa_users enable row level security;
alter table public.summa_vault_meta enable row level security;
alter table public.summa_settings enable row level security;
alter table public.summa_sync_log enable row level security;

drop policy if exists summa_roles_own_select on public.summa_roles;
create policy summa_roles_own_select on public.summa_roles for select using (auth.uid() = user_id or public.summa_is_admin());
drop policy if exists summa_roles_admin_write on public.summa_roles;
create policy summa_roles_admin_write on public.summa_roles for all using (public.summa_is_admin()) with check (public.summa_is_admin());
drop policy if exists summa_users_own on public.summa_users;
create policy summa_users_own on public.summa_users for all using (auth.uid() = user_id or public.summa_is_admin()) with check (auth.uid() = user_id or public.summa_is_admin());
drop policy if exists summa_vault_meta_own on public.summa_vault_meta;
create policy summa_vault_meta_own on public.summa_vault_meta for all using (auth.uid() = user_id or public.summa_is_admin()) with check (auth.uid() = user_id or public.summa_is_admin());
drop policy if exists summa_settings_read on public.summa_settings;
create policy summa_settings_read on public.summa_settings for select using (auth.role() = 'authenticated');
drop policy if exists summa_settings_admin on public.summa_settings;
create policy summa_settings_admin on public.summa_settings for all using (public.summa_is_admin()) with check (public.summa_is_admin());
drop policy if exists summa_sync_log_own_insert on public.summa_sync_log;
create policy summa_sync_log_own_insert on public.summa_sync_log for insert with check (auth.uid() = user_id);
drop policy if exists summa_sync_log_read on public.summa_sync_log;
create policy summa_sync_log_read on public.summa_sync_log for select using (auth.uid() = user_id or public.summa_is_admin());
drop policy if exists summa_sync_log_admin_delete on public.summa_sync_log;
create policy summa_sync_log_admin_delete on public.summa_sync_log for delete using (public.summa_is_admin());

-- 60 MB per object: the sealed vault is the largest single file, receipts are a few MB each.
insert into storage.buckets (id, name, public, file_size_limit)
values ('summa', 'summa', false, 62914560)
on conflict (id) do update set public = false, file_size_limit = 62914560;

-- Per-user storage quota by plan (plans setting → storage_mb; falls back to max_vault_mb, then 50 MB).
create or replace function public.summa_plan_limit_mb(p text)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce(
    ((select value from public.summa_settings where key = 'plans') -> coalesce(p, 'free') ->> 'storage_mb')::integer,
    (select (value #>> '{}')::integer from public.summa_settings where key = 'max_vault_mb'),
    50);
$$;
revoke all on function public.summa_plan_limit_mb(text) from public, anon;
grant execute on function public.summa_plan_limit_mb(text) to authenticated;

-- Bytes a user already stores, excluding one object (the one being replaced by an upsert).
create or replace function public.summa_user_storage_bytes(uid uuid, except_name text default null)
returns bigint language sql stable security definer set search_path = public, storage as $$
  select coalesce(sum((metadata->>'size')::bigint), 0)
  from storage.objects
  where bucket_id = 'summa' and (storage.foldername(name))[1] = uid::text and (except_name is null or name <> except_name);
$$;
revoke all on function public.summa_user_storage_bytes(uuid, text) from public, anon;
grant execute on function public.summa_user_storage_bytes(uuid, text) to authenticated;

create or replace function public.summa_quota_ok(uid uuid, object_name text, new_size bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select public.summa_user_storage_bytes(uid, object_name) + coalesce(new_size, 0)
       <= public.summa_plan_limit_mb((select plan from public.summa_users where user_id = uid))::bigint * 1048576;
$$;
revoke all on function public.summa_quota_ok(uuid, text, bigint) from public, anon;
grant execute on function public.summa_quota_ok(uuid, text, bigint) to authenticated;

drop policy if exists summa_objects_own_select on storage.objects;
create policy summa_objects_own_select on storage.objects for select using (bucket_id = 'summa' and ((storage.foldername(name))[1] = auth.uid()::text or public.summa_is_admin()));
-- Quota is enforced through RLS (Supabase asks not to put triggers on the storage schema).
drop policy if exists summa_objects_own_insert on storage.objects;
create policy summa_objects_own_insert on storage.objects for insert with check (
  bucket_id = 'summa' and (storage.foldername(name))[1] = auth.uid()::text
  and public.summa_quota_ok(auth.uid(), name, (metadata->>'size')::bigint)
);
drop policy if exists summa_objects_own_update on storage.objects;
create policy summa_objects_own_update on storage.objects for update
  using (bucket_id = 'summa' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'summa' and (storage.foldername(name))[1] = auth.uid()::text and public.summa_quota_ok(auth.uid(), name, (metadata->>'size')::bigint));
drop policy if exists summa_objects_own_delete on storage.objects;
create policy summa_objects_own_delete on storage.objects for delete using (bucket_id = 'summa' and ((storage.foldername(name))[1] = auth.uid()::text or public.summa_is_admin()));

-- ---- Two-factor sign-in (authenticator app, Supabase MFA/TOTP). Whoever has turned it on only reaches their data
-- with a session that passed the second factor (aal2); a stolen password alone downloads nothing. Restrictive
-- policies sit on top of the policies above, so everything else stays as it is for people without 2FA.

drop policy if exists summa_objects_mfa on storage.objects;
create policy summa_objects_mfa on storage.objects as restrictive for all to authenticated
  using (bucket_id <> 'summa' or public.summa_mfa_ok()) with check (bucket_id <> 'summa' or public.summa_mfa_ok());
drop policy if exists summa_vault_meta_mfa on public.summa_vault_meta;
create policy summa_vault_meta_mfa on public.summa_vault_meta as restrictive for all to authenticated
  using (public.summa_mfa_ok()) with check (public.summa_mfa_ok());
drop policy if exists summa_sync_log_mfa on public.summa_sync_log;
create policy summa_sync_log_mfa on public.summa_sync_log as restrictive for all to authenticated
  using (public.summa_mfa_ok()) with check (public.summa_mfa_ok());


insert into public.summa_settings (key, value, description) values
  ('min_app_version', '"0.1.0"', 'Ältere App-Versionen werden zum Update aufgefordert'),
  ('maintenance', '{"active": false, "message": ""}', 'Wartungsmodus – blockiert Sync mit Hinweis'),
  ('signups_enabled', 'true', 'Neue Sync-Konten erlauben'),
  ('max_vault_mb', '50', 'Fallback-Speicherlimit pro Nutzer in MB (siehe plans)'),
  ('max_accounts', '20', 'Maximale Anzahl Sync-Konten (Free-Plan-Limits) – darüber Warteliste'),
  ('plans', '{"free": {"label": "Free", "storage_mb": 50, "devices": 3, "price_eur": 0}, "pro": {"label": "Pro", "storage_mb": 500, "devices": 10, "price_eur": 0}, "family": {"label": "Family", "storage_mb": 1000, "devices": 20, "price_eur": 0}}', 'Speicher und Geräte pro Konto'),
  ('feature_flags', '{"ai_cloud": true, "bank_import": true, "invoices": true}', 'Features global ein-/ausschalten'),
  ('module_access', '{"summa": true, "projekte": true, "produkte": true, "produktion": true}', 'Ordo-Module, die jedes Konto installieren darf (pro Konto überschreibbar in summa_users.modules)')
on conflict (key) do nothing;

-- ---- Account cap: the free Supabase plan is sized for a small circle; above the cap the app offers a waitlist.
create or replace function public.summa_signups_open()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare enabled boolean; cap integer; n bigint;
begin
  select (value #>> '{}')::boolean into enabled from public.summa_settings where key = 'signups_enabled';
  select (value #>> '{}')::integer into cap from public.summa_settings where key = 'max_accounts';
  select count(*) into n from auth.users;
  if not coalesce(enabled, true) then return jsonb_build_object('open', false, 'reason', 'closed'); end if;
  if n >= coalesce(cap, 20) then return jsonb_build_object('open', false, 'reason', 'full'); end if;
  return jsonb_build_object('open', true, 'reason', null);
end $$;
revoke all on function public.summa_signups_open() from public;
grant execute on function public.summa_signups_open() to anon, authenticated;

-- Public "free places" counter for the website and the app (only numbers, no personal data).
create or replace function public.summa_public_capacity()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare enabled boolean; cap integer; n bigint;
begin
  select (value #>> '{}')::boolean into enabled from public.summa_settings where key = 'signups_enabled';
  select (value #>> '{}')::integer into cap from public.summa_settings where key = 'max_accounts';
  select count(*) into n from auth.users;
  cap := coalesce(cap, 20);
  return jsonb_build_object('max', cap, 'used', n, 'free', greatest(cap - n, 0), 'open', coalesce(enabled, true) and n < cap);
end $$;
revoke all on function public.summa_public_capacity() from public;
grant execute on function public.summa_public_capacity() to anon, authenticated;

create or replace function public.summa_enforce_signup_cap()
returns trigger language plpgsql security definer set search_path = public as $$
declare state jsonb;
begin
  state := public.summa_signups_open();
  if not (state->>'open')::boolean then
    raise exception using message = case when state->>'reason' = 'closed' then 'SUMMA_SIGNUPS_CLOSED' else 'SUMMA_ACCOUNT_LIMIT' end, errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.summa_enforce_signup_cap() from public, anon, authenticated;
drop trigger if exists summa_signup_cap on auth.users;
create trigger summa_signup_cap before insert on auth.users for each row execute function public.summa_enforce_signup_cap();


-- Keep-alive target for the scheduled GitHub Action (.github/workflows/keepalive.yml): free-plan projects
-- pause after 7 days without database activity. Returns nothing sensitive.
create or replace function public.summa_ping() returns timestamptz language sql stable as $$ select now() $$;
grant execute on function public.summa_ping() to anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Password reset by e-mail (decided by the operator on 2026-10-21): the vault key of an account is kept
-- in Supabase Vault (encrypted at rest), one secret per user, readable only by that signed-in user. A
-- password reset (e-mail code) therefore needs no recovery key. Trade-off, stated in the privacy policy:
-- the operator could technically decrypt an account's data.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.summa_escrow_put(p_key text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_id uuid;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if not public.summa_mfa_ok() then raise exception 'SUMMA_MFA_REQUIRED'; end if;
  if p_key is null or length(p_key) < 32 or length(p_key) > 200 then raise exception 'invalid key'; end if;
  v_name := 'summa_escrow_' || v_uid::text;
  select id into v_id from vault.secrets where name = v_name;
  if v_id is null then
    perform vault.create_secret(p_key, v_name, 'Summa vault key for password reset');
  else
    perform vault.update_secret(v_id, p_key);
  end if;
end $$;

create or replace function public.summa_escrow_get() returns text
language sql stable security definer set search_path = '' as $$
  -- with two-factor sign-in on, an e-mail code alone never hands out the key: the authenticator code is needed too
  select decrypted_secret from vault.decrypted_secrets where name = 'summa_escrow_' || auth.uid()::text and public.summa_mfa_ok();
$$;

revoke all on function public.summa_escrow_put(text) from public, anon;
revoke all on function public.summa_escrow_get() from public, anon;
grant execute on function public.summa_escrow_put(text) to authenticated;
grant execute on function public.summa_escrow_get() to authenticated;

create or replace function public.summa_escrow_cleanup() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from vault.secrets where name = 'summa_escrow_' || old.id::text;
  return old;
end $$;

drop trigger if exists summa_escrow_cleanup on auth.users;
create trigger summa_escrow_cleanup after delete on auth.users for each row execute function public.summa_escrow_cleanup();

-- "Sync-Konto löschen" without an operator function (own databases, community edition): the app removes the
-- account's own files first (storage RLS allows that), then this deletes the login; every summa_* row goes with it
-- (on delete cascade) and the escrowed key through summa_escrow_cleanup.
create or replace function public.summa_delete_self() returns void
language plpgsql volatile security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if not public.summa_mfa_ok() then raise exception 'SUMMA_MFA_REQUIRED'; end if;
  if exists (select 1 from public.summa_roles where user_id = v_uid and role = 'admin')
     and (select count(*) from public.summa_roles where role = 'admin') <= 1 then
    raise exception 'SUMMA_LAST_ADMIN';
  end if;
  if exists (select 1 from storage.objects where bucket_id = 'summa' and (storage.foldername(name))[1] = v_uid::text) then
    raise exception 'SUMMA_FILES_LEFT';
  end if;
  delete from auth.users where id = v_uid;
end $$;
revoke all on function public.summa_delete_self() from public, anon;
grant execute on function public.summa_delete_self() to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Schema version: the app compares it on own projects and asks to run this file again when it is older.
-- Bump it whenever this file gains something the app relies on.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.summa_schema_version() returns integer language sql immutable as $$ select 6 $$;
grant execute on function public.summa_schema_version() to anon, authenticated;


-- Project usage against the Supabase limits, read by the app ("Dein Speicher"). Only numbers. On own projects
-- every member sees them (so everybody learns early when it gets tight), on the Ordo server only admins.
-- Egress is an estimate from the sync log (vault and file downloads); Supabase's usage page has the exact value.
create or replace function public.summa_project_usage()
returns jsonb language plpgsql stable security definer set search_path = public, storage as $$
declare own boolean;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  own := coalesce((select (value #>> '{}')::boolean from public.summa_settings where key = 'own_project'), false);
  if not own and not public.summa_is_admin() then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'own_project', own,
    'schema_version', public.summa_schema_version(),
    'db_bytes', pg_database_size(current_database()),
    'storage_bytes', (select coalesce(sum((metadata->>'size')::bigint), 0) from storage.objects),
    'objects', (select count(*) from storage.objects),
    'accounts', (select count(*) from auth.users),
    'accounts_max', (select (value #>> '{}')::integer from public.summa_settings where key = 'max_accounts'),
    'egress_30d', (select coalesce(sum(bytes), 0) from public.summa_sync_log where ok and action in ('pull', 'download') and created_at > now() - interval '30 days'),
    'active_7d', (select count(distinct user_id) from public.summa_sync_log where created_at > now() - interval '7 days' and user_id is not null),
    'last_activity', (select max(created_at) from public.summa_sync_log)
  );
end $$;
revoke all on function public.summa_project_usage() from public, anon;
grant execute on function public.summa_project_usage() to authenticated;


-- ---------------------------------------------------------------------------------------------------
-- Explicit Data API grants. New Supabase projects (since 2026-05-30) and, from 2026-10-30, every project no
-- longer expose new tables in public automatically. Row-level security stays the gate; these grants only let
-- requests reach it. Existing grants are left untouched.
-- ---------------------------------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on
  public.summa_roles, public.summa_users, public.summa_vault_meta, public.summa_settings, public.summa_sync_log
  to authenticated, service_role;
grant usage, select on sequence public.summa_sync_log_id_seq to authenticated, service_role;
