-- Migration 006: per-user settings (email recipients per engineer, MRR list view)
-- Run once in Supabase -> SQL Editor (safe to run again). Run migration_005 first.

-- Per-user settings kept between sessions: email recipients (colleagues, and To/CC per vendor) and view choices.
create table if not exists public.user_prefs (
  user_id     uuid primary key references public.profiles(id) on delete cascade,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.user_prefs enable row level security;
drop policy if exists user_prefs_select on public.user_prefs;
drop policy if exists user_prefs_insert on public.user_prefs;
drop policy if exists user_prefs_update on public.user_prefs;
create policy user_prefs_select on public.user_prefs for select to authenticated using (user_id = auth.uid());
create policy user_prefs_insert on public.user_prefs for insert to authenticated with check (user_id = auth.uid());
create policy user_prefs_update on public.user_prefs for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on public.user_prefs from anon;
grant select, insert, update on public.user_prefs to authenticated;

notify pgrst, 'reload schema';
