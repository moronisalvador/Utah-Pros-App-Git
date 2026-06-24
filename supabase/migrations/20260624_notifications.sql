-- ════════════════════════════════════════════════
-- Notifications — lightweight org-wide in-app notification feed
-- ════════════════════════════════════════════════
-- A shared (not per-user) feed surfaced by the sidebar notification bell.
-- First producer: e-signature completion (submit-esign worker). Writes happen
-- only via the SECURITY DEFINER create_notification RPC (service-role / worker);
-- reads + mark-read go through RPCs too. Realtime-enabled so the badge updates
-- live and a toast can fire when a new row arrives.

create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  type        text not null,                 -- e.g. 'esign_signed'
  title       text not null,
  body        text,
  link        text,                          -- in-app route to open (e.g. '/jobs/<id>')
  entity_type text,                          -- 'job' | 'claim' | ...
  entity_id   uuid,
  job_id      uuid,
  payload     jsonb not null default '{}'::jsonb,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists notifications_created_at_idx on public.notifications (created_at desc);
create index if not exists notifications_unread_idx on public.notifications (read_at) where read_at is null;

alter table public.notifications enable row level security;

-- Read-only to the app roles; all writes are via the RPC below (service-role / definer).
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select to anon, authenticated using (true);

-- ── RPCs ──────────────────────────────────────────────────────────────────────

create or replace function public.create_notification(
  p_type text,
  p_title text,
  p_body text default null,
  p_link text default null,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_job_id uuid default null,
  p_payload jsonb default '{}'::jsonb
) returns public.notifications
language sql security definer set search_path = public as $$
  insert into public.notifications (type, title, body, link, entity_type, entity_id, job_id, payload)
  values (p_type, p_title, p_body, p_link, p_entity_type, p_entity_id, p_job_id, coalesce(p_payload, '{}'::jsonb))
  returning *;
$$;

create or replace function public.get_notifications(p_limit int default 30)
returns setof public.notifications
language sql security definer set search_path = public as $$
  select * from public.notifications order by created_at desc limit greatest(1, least(p_limit, 100));
$$;

create or replace function public.get_unread_notification_count()
returns int
language sql security definer set search_path = public as $$
  select count(*)::int from public.notifications where read_at is null;
$$;

create or replace function public.mark_notification_read(p_id uuid)
returns void
language sql security definer set search_path = public as $$
  update public.notifications set read_at = now() where id = p_id and read_at is null;
$$;

create or replace function public.mark_all_notifications_read()
returns void
language sql security definer set search_path = public as $$
  update public.notifications set read_at = now() where read_at is null;
$$;

grant execute on function public.create_notification(text, text, text, text, text, uuid, uuid, jsonb) to anon, authenticated, service_role;
grant execute on function public.get_notifications(int)            to anon, authenticated, service_role;
grant execute on function public.get_unread_notification_count()   to anon, authenticated, service_role;
grant execute on function public.mark_notification_read(uuid)      to anon, authenticated, service_role;
grant execute on function public.mark_all_notifications_read()     to anon, authenticated, service_role;

-- Realtime: deliver inserts to subscribed clients (badge + live toast).
do $$ begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null; end $$;
