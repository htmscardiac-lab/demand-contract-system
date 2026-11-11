-- =====================================================================
-- Demand Contract System — Supabase schema (single file, run once)
-- Supabase Dashboard -> SQL Editor -> paste this whole file -> Run
--
-- Contains: tables, contract_balances view, sign-up trigger (first account
-- becomes admin), row level security, audit log triggers, all business
-- functions (RPC), and the "part-images" storage bucket.
-- Ported 1:1 from the local Node/SQLite server (server/logic.js).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null default '',
  email       text unique not null,
  role        text not null default 'engineer'
              check (role in ('engineer','supervisor','clinical_engineer','admin')),
  is_active   boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists public.team_memberships (
  supervisor_id uuid not null references public.profiles(id) on delete cascade,
  engineer_id   uuid not null references public.profiles(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (supervisor_id, engineer_id)
);

create table if not exists public.vendors (
  id            bigint generated always as identity primary key,
  name          text unique not null,
  contact_email text,
  created_at    timestamptz not null default now()
);

-- People to contact at a vendor (the vendor directory). The release email goes to their addresses.
create table if not exists public.vendor_contacts (
  id          bigint generated always as identity primary key,
  vendor_id   bigint not null references public.vendors(id) on delete cascade,
  name        text not null check (trim(name) <> ''),
  email       text,
  phone       text,
  created_at  timestamptz not null default now(),
  position    text,                                  -- job title, from contact_positions
  specialties text[] not null default '{}'           -- one or more, from contact_specialties
);

-- Choices offered in the vendor directory. Editable by supervisors and administrators.
create table if not exists public.contact_positions (
  id   bigint generated always as identity primary key,
  name text unique not null check (trim(name) <> '')
);
create table if not exists public.contact_specialties (
  id   bigint generated always as identity primary key,
  name text unique not null check (trim(name) <> '')
);
insert into public.contact_positions(name) values ('Maintenance Engineer'), ('Sales'), ('Clinical Specialist')
  on conflict (name) do nothing;
insert into public.contact_specialties(name) values ('General'), ('Ventilators'), ('Anesthesia')
  on conflict (name) do nothing;

create table if not exists public.contracts (
  id                        bigint generated always as identity primary key,
  contract_number           text unique not null,
  po_number                 text not null,
  vendor_id                 bigint not null references public.vendors(id),
  total_amount              numeric(14,2) not null check (total_amount >= 0),
  previous_consumed_amount  numeric(14,2) not null default 0 check (previous_consumed_amount >= 0),
  start_date                date not null,
  end_date                  date not null,
  created_by                uuid references public.profiles(id) on delete set null,
  created_at                timestamptz not null default now(),
  -- VAT is released against its own contract line: quantity = VAT amount / line value
  vat_line_number           integer,
  vat_line_value            numeric(14,2) check (vat_line_value > 0)
);

create table if not exists public.contract_items (
  id           bigint generated always as identity primary key,
  contract_id  bigint not null references public.contracts(id) on delete cascade,
  line_number  integer not null,
  description  text not null,
  part_number  text not null,
  unit_price   numeric(14,2) not null check (unit_price >= 0),
  device_model text,
  equipment_description text,
  taxable      boolean not null default false,
  image_path   text,
  unique (contract_id, line_number)
);

create table if not exists public.requests (
  id                  bigint generated always as identity primary key,
  request_number      text unique not null,
  contract_id         bigint not null references public.contracts(id),
  engineer_id         uuid not null references public.profiles(id),
  supervisor_id       uuid not null references public.profiles(id),
  status              text not null default 'pending'
                      check (status in ('pending','pending_clinical','in_process','approved',
                                        'closed','returned','rejected','cancelled')),
  rejection_reason    text,
  return_reason       text,
  return_notes        jsonb,          -- notes per line from the last return
  submitted_at        timestamptz not null default now(),
  decided_at          timestamptz,
  returned_at         timestamptz,
  resubmitted_at      timestamptz,
  release_number      text,
  release_status      text,
  promise_date        date,
  last_followup_date  date,
  archived            boolean not null default false
);

create table if not exists public.request_items (
  id                     bigint generated always as identity primary key,
  request_id             bigint not null references public.requests(id) on delete cascade,
  contract_item_id       bigint references public.contract_items(id),   -- null on the VAT line
  part_number            text not null,
  description            text not null,
  unit_price             numeric(14,2) not null,
  quantity               numeric(14,4) not null check (quantity > 0),
  htm_number             text not null,
  serial_number          text not null,
  work_order_number      text not null,
  received_quantity      numeric(14,4) not null default 0,
  received_at            timestamptz,
  received_by            uuid references public.profiles(id) on delete set null,
  line_number            integer,
  equipment_description  text,
  device_model           text,
  taxable                boolean not null default false,
  is_vat                 boolean not null default false
);

-- MRR (Material Receiving Report): entered by the clinical engineer and linked to received lines.
-- One MRR belongs to one request; a request can have several when parts arrive in batches.
create table if not exists public.mrrs (
  id          bigint generated always as identity primary key,
  request_id  bigint not null references public.requests(id) on delete cascade,
  mrr_number  text unique not null check (trim(mrr_number) <> ''),
  mrr_date    date not null default current_date,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- Every receipt of a request line (full or partial). A receipt is linked to at most one MRR.
create table if not exists public.request_receipts (
  id               bigint generated always as identity primary key,
  request_id       bigint not null references public.requests(id) on delete cascade,
  request_item_id  bigint not null references public.request_items(id) on delete cascade,
  quantity         numeric(14,4) not null check (quantity > 0),
  received_at      timestamptz not null default now(),
  received_by      uuid references public.profiles(id) on delete set null,
  mrr_id           bigint references public.mrrs(id) on delete set null
);

create table if not exists public.notifications (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  type         text not null,
  message      text not null,
  request_id   bigint references public.requests(id) on delete cascade,
  contract_id  bigint references public.contracts(id) on delete cascade,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);

create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid,
  action      text not null,
  table_name  text not null,
  record_id   text not null,
  old_values  jsonb,
  new_values  jsonb,
  created_at  timestamptz not null default now()
);

create table if not exists public.app_settings (
  key         text primary key,
  value       text,
  updated_at  timestamptz,
  updated_by  uuid
);

insert into public.app_settings(key, value) values
  ('department_email', ''),
  ('department_name', 'Healthcare Technology Management Services (HTMS)')
on conflict (key) do nothing;

-- Columns added after the first release (safe to re-run on an existing database).
-- The balances view reads request_items.quantity, so it is dropped here and
-- recreated in section 3 after the column types are changed.
drop view if exists public.contract_balances;

alter table public.contract_items add column if not exists device_model text;
alter table public.contract_items add column if not exists taxable boolean not null default false;
alter table public.request_items  add column if not exists taxable boolean not null default false;

alter table public.contract_items add column if not exists equipment_description text;
alter table public.vendor_contacts add column if not exists position text;
alter table public.vendor_contacts add column if not exists specialties text[] not null default '{}';
alter table public.requests add column if not exists return_notes jsonb;
alter table public.contracts add column if not exists vat_line_number integer;
alter table public.contracts add column if not exists vat_line_value numeric(14,2) check (vat_line_value > 0);
alter table public.request_items add column if not exists is_vat boolean not null default false;
alter table public.request_items alter column contract_item_id drop not null;
alter table public.request_items alter column quantity type numeric(14,4);
alter table public.request_items alter column received_quantity type numeric(14,4);
alter table public.request_items drop constraint if exists request_items_quantity_check;
alter table public.request_items add constraint request_items_quantity_check check (quantity > 0);

create sequence if not exists public.request_number_seq;

create index if not exists idx_requests_contract    on public.requests(contract_id);
create index if not exists idx_requests_engineer    on public.requests(engineer_id);
create index if not exists idx_requests_supervisor  on public.requests(supervisor_id);
create index if not exists idx_requests_status      on public.requests(status);
create index if not exists idx_request_items_req    on public.request_items(request_id);
create index if not exists idx_request_items_dup    on public.request_items(part_number, serial_number);
create index if not exists idx_contract_items_con   on public.contract_items(contract_id);
create index if not exists idx_vendor_contacts_vendor on public.vendor_contacts(vendor_id);
create index if not exists idx_receipts_request on public.request_receipts(request_id);
create index if not exists idx_receipts_mrr on public.request_receipts(mrr_id);
create index if not exists idx_mrrs_request on public.mrrs(request_id);
create index if not exists idx_notifications_user   on public.notifications(user_id, created_at desc);

-- ---------------------------------------------------------------------
-- 2. Helper functions (security definer so they can be used inside RLS)
-- ---------------------------------------------------------------------
create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and is_active)
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and is_active and role = 'admin')
$$;

create or replace function public.is_clinical() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and is_active and role = 'clinical_engineer')
$$;

create or replace function public.is_supervisor() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and is_active and role = 'supervisor')
$$;

create or replace function public.on_team_of(p_engineer uuid, p_supervisor uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from team_memberships where supervisor_id = p_supervisor and engineer_id = p_engineer)
$$;

-- Who can see a request: admin, clinical engineers, its supervisor, its
-- engineer, and every engineer on that supervisor's team.
create or replace function public.can_view_request(p_engineer uuid, p_supervisor uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_active_user() and (
    public.is_admin() or public.is_clinical()
    or p_supervisor = auth.uid() or p_engineer = auth.uid()
    or public.on_team_of(auth.uid(), p_supervisor)
  )
$$;

create or replace function public.contract_remaining(p_contract_id bigint) returns numeric
language sql stable security definer set search_path = public as $$
  select c.total_amount - c.previous_consumed_amount - coalesce((
    select sum(ri.unit_price * ri.quantity)
    from request_items ri join requests r on r.id = ri.request_id
    where r.contract_id = c.id
      and r.status in ('pending_clinical','in_process','approved','closed')), 0)
  from contracts c where c.id = p_contract_id
$$;

create or replace function public.notify_user(p_user uuid, p_type text, p_message text, p_request_id bigint default null)
returns void language sql security definer set search_path = public as $$
  insert into notifications(user_id, type, message, request_id) values (p_user, p_type, p_message, p_request_id)
$$;

create or replace function public.notify_clinical_pool(p_type text, p_message text, p_request_id bigint)
returns void language sql security definer set search_path = public as $$
  insert into notifications(user_id, type, message, request_id)
  select id, p_type, p_message, p_request_id from profiles where role = 'clinical_engineer' and is_active
$$;

-- ---------------------------------------------------------------------
-- 3. Contract balances view (visible to every active user)
-- ---------------------------------------------------------------------
create or replace view public.contract_balances as
select
  c.id as contract_id,
  c.total_amount,
  c.previous_consumed_amount,
  coalesce(s.spend, 0)::numeric(14,2) as approved_spend,
  (c.total_amount - c.previous_consumed_amount - coalesce(s.spend, 0))::numeric(14,2) as remaining
from public.contracts c
left join (
  select r.contract_id, sum(ri.unit_price * ri.quantity) as spend
  from public.request_items ri join public.requests r on r.id = ri.request_id
  where r.status in ('pending_clinical','in_process','approved','closed')
  group by r.contract_id
) s on s.contract_id = c.id
where public.is_active_user();

-- ---------------------------------------------------------------------
-- 4. Sign-up trigger: create the profile; first account = active admin
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  first_admin boolean;
begin
  select not exists (select 1 from profiles where role = 'admin') into first_admin;
  insert into profiles(id, full_name, email, role, is_active)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email, '@', 1)),
    lower(new.email),
    case when first_admin then 'admin' else 'engineer' end,
    first_admin
  );
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- 5. Audit log (automatic on every insert / update / delete)
-- ---------------------------------------------------------------------
create or replace function public.audit_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  n jsonb := case when tg_op in ('UPDATE','INSERT') then to_jsonb(new) end;
  rid text;
begin
  rid := coalesce(n->>'id', o->>'id', n->>'key', o->>'key',
                  coalesce(n->>'supervisor_id', o->>'supervisor_id') || '/' || coalesce(n->>'engineer_id', o->>'engineer_id'),
                  '?');
  insert into audit_log(actor_id, action, table_name, record_id, old_values, new_values)
  values (auth.uid(), tg_op, tg_table_name, rid, o, n);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['profiles','team_memberships','vendors','vendor_contacts','contact_positions','contact_specialties',
                           'contracts','contract_items','requests','request_items','mrrs','request_receipts','app_settings'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$s', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$s
                    for each row execute function public.audit_trigger()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 6. Row level security
-- ---------------------------------------------------------------------
alter table public.profiles          enable row level security;
alter table public.team_memberships  enable row level security;
alter table public.vendors           enable row level security;
alter table public.vendor_contacts   enable row level security;
alter table public.contact_positions enable row level security;
alter table public.contact_specialties enable row level security;
alter table public.mrrs              enable row level security;
alter table public.request_receipts  enable row level security;
alter table public.contracts         enable row level security;
alter table public.contract_items    enable row level security;
alter table public.requests          enable row level security;
alter table public.request_items     enable row level security;
alter table public.notifications     enable row level security;
alter table public.audit_log         enable row level security;
alter table public.app_settings      enable row level security;

do $$
declare p record;
begin
  for p in select policyname, tablename from pg_policies where schemaname = 'public'
           and tablename in ('profiles','team_memberships','vendors','vendor_contacts','contact_positions','contact_specialties',
                             'mrrs','request_receipts','contracts','contract_items',
                             'requests','request_items','notifications','audit_log','app_settings') loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

-- profiles: you always see your own row (needed for the "pending activation"
-- screen); active users see everyone; only an admin can change them.
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_active_user());
create policy profiles_update on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy profiles_delete on public.profiles for delete to authenticated
  using (public.is_admin());

create policy team_select on public.team_memberships for select to authenticated using (public.is_active_user());
create policy team_insert on public.team_memberships for insert to authenticated with check (public.is_admin());
create policy team_delete on public.team_memberships for delete to authenticated using (public.is_admin());

-- vendors / contracts / contract items: read = any active user,
-- write = admin or supervisor.
create policy vendors_select on public.vendors for select to authenticated using (public.is_active_user());
create policy vendors_write  on public.vendors for all to authenticated
  using (public.is_admin() or public.is_supervisor()) with check (public.is_admin() or public.is_supervisor());

create policy vendor_contacts_select on public.vendor_contacts for select to authenticated using (public.is_active_user());
create policy vendor_contacts_write  on public.vendor_contacts for all to authenticated
  using (public.is_admin() or public.is_supervisor()) with check (public.is_admin() or public.is_supervisor());

create policy contracts_select on public.contracts for select to authenticated using (public.is_active_user());
create policy contracts_write  on public.contracts for all to authenticated
  using (public.is_admin() or public.is_supervisor()) with check (public.is_admin() or public.is_supervisor());

create policy contract_items_select on public.contract_items for select to authenticated using (public.is_active_user());
create policy contract_items_write  on public.contract_items for all to authenticated
  using (public.is_admin() or public.is_supervisor()) with check (public.is_admin() or public.is_supervisor());

-- requests: read only. Every change goes through the functions in section 7.
create policy requests_select on public.requests for select to authenticated
  using (public.can_view_request(engineer_id, supervisor_id));
create policy request_items_select on public.request_items for select to authenticated
  using (exists (select 1 from public.requests r where r.id = request_id
                 and public.can_view_request(r.engineer_id, r.supervisor_id)));

create policy contact_positions_select on public.contact_positions for select to authenticated using (public.is_active_user());
create policy contact_positions_write  on public.contact_positions for all to authenticated
  using (public.is_admin() or public.is_supervisor()) with check (public.is_admin() or public.is_supervisor());
create policy contact_specialties_select on public.contact_specialties for select to authenticated using (public.is_active_user());
create policy contact_specialties_write  on public.contact_specialties for all to authenticated
  using (public.is_admin() or public.is_supervisor()) with check (public.is_admin() or public.is_supervisor());

-- receipts and MRRs: read with the request; changed only through the functions in section 7
create policy receipts_select on public.request_receipts for select to authenticated
  using (exists (select 1 from public.requests r where r.id = request_id
                 and public.can_view_request(r.engineer_id, r.supervisor_id)));
create policy mrrs_select on public.mrrs for select to authenticated
  using (exists (select 1 from public.requests r where r.id = request_id
                 and public.can_view_request(r.engineer_id, r.supervisor_id)));

create policy notifications_select on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy audit_select on public.audit_log for select to authenticated using (public.is_admin());

create policy settings_select on public.app_settings for select to authenticated using (public.is_active_user());
create policy settings_insert on public.app_settings for insert to authenticated with check (public.is_admin());
create policy settings_update on public.app_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- 7. Business functions (called from the app with supabase.rpc)
-- ---------------------------------------------------------------------

-- Shared: validate the lines of a request, return the total.
create or replace function public._validate_items(p_contract_id bigint, p_items jsonb) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare
  it jsonb; ci contract_items; total numeric := 0; q integer;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'The request must contain at least one item.';
  end if;
  for it in select * from jsonb_array_elements(p_items) loop
    select * into ci from contract_items
      where id = (it->>'contract_item_id')::bigint and contract_id = p_contract_id;
    if not found then
      raise exception 'Item % does not belong to this contract.', it->>'contract_item_id';
    end if;
    q := (it->>'quantity')::integer;
    if q is null or q < 1 then raise exception 'Quantity must be at least 1.'; end if;
    if coalesce(trim(it->>'htm_number'), '') = '' or coalesce(trim(it->>'serial_number'), '') = ''
       or coalesce(trim(it->>'work_order_number'), '') = '' then
      raise exception 'HTM Number, Serial Number and Work Order Number are required for every line.';
    end if;
    total := total + ci.unit_price * q;
  end loop;
  return total;
end $$;

-- VAT due on the taxable lines of a request, expressed on the contract's VAT line.
-- VAT rate is 15%. Quantity on the VAT line = VAT amount / VAT line value, to 4 decimals.
create or replace function public._vat_for(p_contract_id bigint, p_items jsonb,
  out vat_qty numeric, out vat_amount numeric, out vat_line integer, out vat_value numeric)
language plpgsql stable security definer set search_path = public as $$
declare taxable_total numeric; c contracts;
begin
  vat_qty := 0; vat_amount := 0;
  select coalesce(sum(ci.unit_price * (it->>'quantity')::integer), 0) into taxable_total
    from jsonb_array_elements(p_items) it
    join contract_items ci on ci.id = (it->>'contract_item_id')::bigint and ci.contract_id = p_contract_id
   where ci.taxable;
  if taxable_total = 0 then return; end if;
  select * into c from contracts where id = p_contract_id;
  if c.vat_line_number is null or c.vat_line_value is null then
    raise exception 'VAT_LINE_MISSING: this request has parts with VAT, but the contract has no VAT line. Ask a supervisor to set the VAT line on the contract first.';
  end if;
  vat_line := c.vat_line_number; vat_value := c.vat_line_value;
  vat_qty := round(round(taxable_total * 0.15, 2) / c.vat_line_value, 4);
  vat_amount := round(vat_qty * c.vat_line_value, 2);
end $$;

create or replace function public._insert_items(p_request_id bigint, p_contract_id bigint, p_items jsonb) returns void
language sql security definer set search_path = public as $$
  insert into request_items(request_id, contract_item_id, part_number, description, unit_price, quantity,
                            htm_number, serial_number, work_order_number, line_number,
                            equipment_description, device_model, taxable)
  select p_request_id, ci.id, ci.part_number, ci.description, ci.unit_price, (it->>'quantity')::integer,
         trim(it->>'htm_number'), trim(it->>'serial_number'), trim(it->>'work_order_number'), ci.line_number,
         -- equipment description and model come from the contract line; typed values only fill a blank
         coalesce(nullif(trim(ci.equipment_description), ''), trim(it->>'equipment_description'), ''),
         -- model comes from the contract line; a value typed on the request only fills a blank
         coalesce(nullif(trim(ci.device_model), ''), trim(it->>'device_model'), ''),
         ci.taxable
  from jsonb_array_elements(p_items) with ordinality as x(it, ord)
  join contract_items ci on ci.id = (it->>'contract_item_id')::bigint and ci.contract_id = p_contract_id
  order by ci.line_number, ord;   -- lines are stored in contract line order

  -- the VAT line, added automatically when any requested part is taxable
  insert into request_items(request_id, contract_item_id, part_number, description, unit_price, quantity,
                            htm_number, serial_number, work_order_number, line_number,
                            equipment_description, device_model, taxable, is_vat)
  select p_request_id, null, 'VAT', 'Value Added Tax (15%)', v.vat_value, v.vat_qty,
         '', '', '', v.vat_line, '', '', false, true
  from _vat_for(p_contract_id, p_items) v
  where v.vat_qty > 0;
$$;

create or replace function public.check_duplicates(p_items jsonb) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'part_number', ri.part_number, 'serial_number', ri.serial_number,
    'request_number', r.request_number, 'status', r.status, 'engineer_name', p.full_name)), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) it
  join request_items ri on ri.part_number = it->>'part_number' and ri.serial_number = it->>'serial_number'
  join requests r on r.id = ri.request_id
  join profiles p on p.id = r.engineer_id
  where public.is_active_user()
    and not ri.is_vat
    and (r.status in ('pending','pending_clinical')
         or (r.status in ('in_process','approved') and ri.received_quantity < ri.quantity))
$$;

create or replace function public.submit_request(p_contract_id bigint, p_supervisor_id text, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me profiles; sup uuid; st text; total numeric; vat numeric; remaining numeric; rid bigint; rno text;
begin
  select * into me from profiles where id = auth.uid();
  if me.id is null or not me.is_active then raise exception 'Your account is not active yet.'; end if;
  if me.role not in ('engineer','supervisor','admin') then raise exception 'This role cannot submit requests.'; end if;

  if me.role = 'supervisor' then
    sup := me.id; st := 'pending_clinical';
  else
    sup := nullif(p_supervisor_id, '')::uuid; st := 'pending';
    if sup is null then raise exception 'Please choose a supervisor.'; end if;
    if me.role <> 'admin' and not on_team_of(me.id, sup) then
      raise exception 'Selected supervisor is not one of your supervisors.';
    end if;
  end if;

  perform 1 from contracts where id = p_contract_id for update;
  if not found then raise exception 'Contract not found.'; end if;
  total := _validate_items(p_contract_id, p_items);
  select vat_amount into vat from _vat_for(p_contract_id, p_items);
  total := total + vat;   -- prices on contract lines are before VAT
  remaining := contract_remaining(p_contract_id);
  if total > remaining then
    raise exception 'INSUFFICIENT_BALANCE: request total (%) exceeds remaining contract balance (%).',
      to_char(total, 'FM999999999990.00'), to_char(remaining, 'FM999999999990.00');
  end if;

  rno := 'REQ-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('request_number_seq')::text, 5, '0');
  insert into requests(request_number, contract_id, engineer_id, supervisor_id, status)
    values (rno, p_contract_id, me.id, sup, st) returning id into rid;
  perform _insert_items(rid, p_contract_id, p_items);

  if st = 'pending' then
    perform notify_user(sup, 'request_submitted',
      format('New request %s submitted by %s — total %s', rno, me.full_name, to_char(total, 'FM999999999990.00')), rid);
  else
    perform notify_clinical_pool('request_at_clinical',
      format('Request %s was sent to the Clinical Engineer (created by %s).', rno, me.full_name), rid);
  end if;
  return jsonb_build_object('request_id', rid, 'request_number', rno, 'total', total, 'vat', vat, 'status', st);
end $$;

create or replace function public.update_request(p_request_id bigint, p_items jsonb, p_supervisor_id text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me profiles; r requests; sup uuid; total numeric; vat numeric;
begin
  select * into me from profiles where id = auth.uid();
  select * into r from requests where id = p_request_id for update;
  if r.id is null then raise exception 'Request not found.'; end if;
  if me.id is null or not me.is_active or r.status not in ('pending','returned')
     or not (r.engineer_id = me.id or me.role = 'admin') then
    raise exception 'This request can no longer be edited.';
  end if;
  sup := coalesce(nullif(p_supervisor_id, '')::uuid, r.supervisor_id);
  if me.role = 'engineer' and not on_team_of(r.engineer_id, sup) then
    raise exception 'Selected supervisor is not one of your supervisors.';
  end if;
  perform 1 from contracts where id = r.contract_id for update;
  total := _validate_items(r.contract_id, p_items);
  select vat_amount into vat from _vat_for(r.contract_id, p_items);
  total := total + vat;
  if total > contract_remaining(r.contract_id) then
    raise exception 'INSUFFICIENT_BALANCE: request total (%) exceeds remaining contract balance.',
      to_char(total, 'FM999999999990.00');
  end if;
  delete from request_items where request_id = p_request_id;
  perform _insert_items(p_request_id, r.contract_id, p_items);
  update requests set supervisor_id = sup where id = p_request_id;
  return jsonb_build_object('request_id', p_request_id, 'total', total, 'vat', vat);
end $$;

create or replace function public.cancel_request(p_request_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare r requests;
begin
  select * into r from requests where id = p_request_id for update;
  if r.id is null then raise exception 'Request not found.'; end if;
  if not (is_admin() or (r.engineer_id = auth.uid() and is_active_user())) then
    raise exception 'Only the account that created the request can cancel it.';
  end if;
  if r.status not in ('pending','returned','pending_clinical') then
    raise exception 'This request can no longer be cancelled.';
  end if;
  update requests set status = 'cancelled' where id = p_request_id;
  perform notify_user(r.supervisor_id, 'request_cancelled',
    format('Request %s was cancelled.', r.request_number), r.id);
end $$;

create or replace function public.resubmit_request(p_request_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare r requests; total numeric; st text;
begin
  select * into r from requests where id = p_request_id for update;
  if r.id is null then raise exception 'Request not found.'; end if;
  if not (is_admin() or (r.engineer_id = auth.uid() and is_active_user())) then
    raise exception 'Only the owner can resubmit this request.';
  end if;
  if r.status <> 'returned' then raise exception 'Only a returned request can be resubmitted.'; end if;
  perform 1 from contracts where id = r.contract_id for update;
  select coalesce(sum(unit_price * quantity), 0) into total from request_items where request_id = p_request_id;
  if total > contract_remaining(r.contract_id) then
    raise exception 'INSUFFICIENT_BALANCE: request total exceeds the remaining contract balance.';
  end if;
  select case when role = 'supervisor' then 'pending_clinical' else 'pending' end into st
    from profiles where id = r.engineer_id;
  update requests set status = st, resubmitted_at = now(), submitted_at = now() where id = p_request_id;
  if st = 'pending' then
    perform notify_user(r.supervisor_id, 'request_resubmitted',
      format('Request %s was updated and resubmitted.', r.request_number), r.id);
  else
    perform notify_clinical_pool('request_at_clinical',
      format('Request %s was updated and sent to the Clinical Engineer.', r.request_number), r.id);
  end if;
end $$;

create or replace function public.decide_request(p_request_id bigint, p_decision text, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r requests; total numeric;
begin
  select * into r from requests where id = p_request_id for update;
  if r.id is null then raise exception 'Request not found.'; end if;
  if not (is_admin() or (r.supervisor_id = auth.uid() and is_active_user())) then
    raise exception 'Only the request''s supervisor (or an admin) can decide it.';
  end if;
  if r.status <> 'pending' then raise exception 'Request is not pending a supervisor decision.'; end if;

  if p_decision = 'approved' then
    perform 1 from contracts where id = r.contract_id for update;
    select coalesce(sum(unit_price * quantity), 0) into total from request_items where request_id = p_request_id;
    if total > contract_remaining(r.contract_id) then
      raise exception 'INSUFFICIENT_BALANCE: approving this request would exceed the contract balance.';
    end if;
    update requests set status = 'pending_clinical', decided_at = now() where id = p_request_id;
    perform notify_user(r.engineer_id, 'request_approved',
      format('Your request %s was approved by your supervisor and sent to the Clinical Engineer.', r.request_number), r.id);
    perform notify_clinical_pool('request_at_clinical',
      format('Request %s was sent to the Clinical Engineer.', r.request_number), r.id);
  elsif p_decision = 'rejected' then
    if coalesce(trim(p_reason), '') = '' then raise exception 'A rejection reason is required.'; end if;
    update requests set status = 'rejected', decided_at = now(), rejection_reason = trim(p_reason) where id = p_request_id;
    perform notify_user(r.engineer_id, 'request_rejected',
      format('Your request %s was rejected. Reason: %s', r.request_number, trim(p_reason)), r.id);
  else
    raise exception 'Decision must be approved or rejected.';
  end if;
end $$;

create or replace function public.update_tracking(p_request_id bigint, p_release_number text default null,
  p_release_status text default null, p_promise_date text default null, p_last_followup_date text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r requests;
begin
  select * into r from requests where id = p_request_id for update;
  if r.id is null then raise exception 'Request not found.'; end if;
  if not can_view_request(r.engineer_id, r.supervisor_id) then
    raise exception 'You do not have permission to update tracking for this request.';
  end if;
  if r.status not in ('in_process','approved','closed') then
    raise exception 'Tracking fields can only be edited after processing.';
  end if;
  update requests set release_number = nullif(p_release_number, ''), release_status = nullif(p_release_status, ''),
         promise_date = nullif(p_promise_date, '')::date, last_followup_date = nullif(p_last_followup_date, '')::date
   where id = p_request_id;
end $$;


-- N working days after a date. Working week is Sunday to Thursday.
create or replace function public.add_working_days(p_from date, p_days integer) returns date
language plpgsql immutable as $$
declare d date := p_from; n integer := 0;
begin
  while n < p_days loop
    d := d + 1;
    if extract(dow from d) not in (5, 6) then n := n + 1; end if;   -- 5 = Friday, 6 = Saturday
  end loop;
  return d;
end $$;

-- The VAT line is received automatically: 15% of the taxed parts received so far,
-- as a quantity of the VAT line. It is complete when every taxed part is complete.
create or replace function public._sync_vat(p_request_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare v request_items; tx numeric; done boolean; nv numeric;
begin
  select * into v from request_items where request_id = p_request_id and is_vat limit 1;
  if v.id is null then return; end if;
  select coalesce(sum(unit_price * received_quantity), 0), coalesce(bool_and(received_quantity >= quantity), true)
    into tx, done from request_items where request_id = p_request_id and taxable and not is_vat;
  nv := case when done then v.quantity else least(v.quantity, round(round(tx * 0.15, 2) / v.unit_price, 4)) end;
  update request_items set received_quantity = nv,
         received_at = case when nv >= v.quantity then coalesce(received_at, now()) else null end
   where id = v.id;
end $$;

-- Complete: every part fully received. Archived: complete and every receipt covered by an MRR.
create or replace function public._maybe_close(p_request_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare r requests;
begin
  if exists (select 1 from request_items where request_id = p_request_id and not is_vat and received_quantity < quantity) then return; end if;
  select * into r from requests where id = p_request_id;
  if r.status = 'approved' then
    update requests set status = 'closed' where id = p_request_id;
    r.status := 'closed';
    perform notify_user(u, 'items_received',
      format('Request %s is fully received and complete. It is archived once its MRR is recorded.', r.request_number), r.id)
    from (select distinct unnest(array[r.engineer_id, r.supervisor_id]) as u) x;
    perform notify_clinical_pool('mrr_needed', format('Request %s is fully received and waiting for its MRR.', r.request_number), r.id);
  end if;
  if r.status = 'closed' and not r.archived
     and exists (select 1 from request_receipts where request_id = p_request_id)
     and not exists (select 1 from request_receipts where request_id = p_request_id and mrr_id is null) then
    update requests set archived = true where id = p_request_id;
  end if;
end $$;

drop function if exists public.receive_items(bigint, integer);
create or replace function public.receive_items(p_item_id bigint, p_quantity numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare it request_items; r requests; nv numeric;
begin
  select * into it from request_items where id = p_item_id for update;
  if it.id is null then raise exception 'Item not found.'; end if;
  select * into r from requests where id = it.request_id;
  if not can_view_request(r.engineer_id, r.supervisor_id) then
    raise exception 'You do not have permission to receive items on this request.';
  end if;
  if r.status not in ('in_process','approved') then
    raise exception 'Items can only be received while the request is in process or approved.';
  end if;
  if it.is_vat then raise exception 'The VAT line is received automatically with its parts.'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Received quantity must be more than zero.'; end if;
  if p_quantity <> trunc(p_quantity) then raise exception 'Parts are received in whole units.'; end if;
  nv := it.received_quantity + p_quantity;
  if nv > it.quantity then
    raise exception 'Received quantity (%) would exceed the requested quantity (%). Outstanding: %.',
      nv, it.quantity, it.quantity - it.received_quantity;
  end if;
  update request_items set received_quantity = nv,
         received_at = case when nv >= it.quantity then now() else null end,
         received_by = auth.uid()
   where id = p_item_id;
  -- the receipt log: who received what and when
  insert into request_receipts(request_id, request_item_id, quantity, received_by)
    values (r.id, p_item_id, p_quantity, auth.uid());
  perform _sync_vat(r.id);
  perform _maybe_close(r.id);
  return jsonb_build_object('received', nv, 'outstanding', it.quantity - nv, 'fully_received', nv >= it.quantity);
end $$;

-- Record a receipt for several lines at once: [{"item_id": 12, "quantity": 2}, ...]. All or nothing.
create or replace function public.receive_lines(p_request_id bigint, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l jsonb; n integer := 0;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Select at least one line to receive.';
  end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    if not exists (select 1 from request_items where id = (l->>'item_id')::bigint and request_id = p_request_id) then
      raise exception 'A selected line is not on this request.';
    end if;
    perform receive_items((l->>'item_id')::bigint, (l->>'quantity')::numeric);
    n := n + 1;
  end loop;
  return jsonb_build_object('lines', n);
end $$;

create or replace function public.receive_all(p_request_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare r requests; it record;
begin
  select * into r from requests where id = p_request_id;
  if r.id is null then raise exception 'Request not found.'; end if;
  if not can_view_request(r.engineer_id, r.supervisor_id) then
    raise exception 'You do not have permission to receive items on this request.';
  end if;
  for it in select id, quantity - received_quantity as left_qty from request_items
            where request_id = p_request_id and not is_vat and received_quantity < quantity order by id loop
    perform receive_items(it.id, it.left_qty);
  end loop;
end $$;

-- Undo a submitted receipt (clinical engineer or administrator). Not allowed once it is covered by an MRR.
create or replace function public.cancel_receipt(p_receipt_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare x request_receipts;
begin
  if not (is_admin() or is_clinical()) then raise exception 'Only a clinical engineer (or an admin) can cancel a receipt.'; end if;
  select * into x from request_receipts where id = p_receipt_id for update;
  if x.id is null then raise exception 'Receipt not found.'; end if;
  if x.mrr_id is not null then raise exception 'This receipt is covered by an MRR. Remove the MRR first.'; end if;
  update request_items set received_quantity = greatest(0, received_quantity - x.quantity), received_at = null
   where id = x.request_item_id;
  delete from request_receipts where id = x.id;
  perform _sync_vat(x.request_id);
  update requests set status = 'approved', archived = false where id = x.request_id and status = 'closed';
end $$;

-- Remove an MRR entered by mistake; its lines go back to "received, no MRR" and the request leaves the archive.
create or replace function public.delete_mrr(p_mrr_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare rid bigint;
begin
  if not (is_admin() or is_clinical()) then raise exception 'Only a clinical engineer (or an admin) can remove an MRR.'; end if;
  delete from mrrs where id = p_mrr_id returning request_id into rid;
  if rid is null then raise exception 'MRR not found.'; end if;
  update requests set archived = false where id = rid;
end $$;

-- Return a request for amendment. p_reason: general note. p_line_notes: [{"item_id": 12, "note": "..."}]. Both optional.
drop function if exists public.return_request(bigint, text);
create or replace function public.return_request(p_request_id bigint, p_reason text default null, p_line_notes jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
declare r requests; notes jsonb;
begin
  select * into r from requests where id = p_request_id for update;
  if r.id is null then raise exception 'Request not found.'; end if;
  if r.status = 'pending' then
    if not (is_admin() or (r.supervisor_id = auth.uid() and is_active_user())) then
      raise exception 'Only the request''s supervisor can return it at this stage.';
    end if;
  elsif r.status = 'pending_clinical' then
    if not (is_admin() or is_clinical()) then
      raise exception 'Only a clinical engineer can return the request at this stage.';
    end if;
  else
    raise exception 'This request cannot be returned in its current status.';
  end if;
  -- keep a copy of each noted line, so the notes stay readable while the engineer edits the request
  select jsonb_agg(jsonb_build_object('line_number', ri.line_number, 'part_number', ri.part_number,
           'description', ri.description, 'htm_number', ri.htm_number, 'note', trim(n->>'note')) order by ri.line_number, ri.id)
    into notes
    from jsonb_array_elements(coalesce(p_line_notes, '[]'::jsonb)) n
    join request_items ri on ri.id = (n->>'item_id')::bigint and ri.request_id = p_request_id
   where coalesce(trim(n->>'note'), '') <> '';
  update requests set status = 'returned', return_reason = nullif(trim(coalesce(p_reason, '')), ''),
         return_notes = notes, returned_at = now() where id = p_request_id;
  perform notify_user(r.engineer_id, 'request_returned',
    format('Request %s was returned to you for amendment.%s', r.request_number,
           case when coalesce(trim(p_reason), '') <> '' then ' Note: ' || trim(p_reason) else ' Open it to see the notes.' end), r.id);
end $$;

-- Issue the release. The promise date is set later, when the request is marked approved.
create or replace function public.complete_request(p_request_id bigint, p_release_number text, p_promise_date text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r requests;
begin
  select * into r from requests where id = p_request_id for update;
  if r.id is null then raise exception 'Request not found.'; end if;
  if not (is_admin() or is_clinical()) then
    raise exception 'Only a clinical engineer (or an admin) can complete a request.';
  end if;
  if r.status <> 'pending_clinical' then raise exception 'This request is not awaiting procurement completion.'; end if;
  if coalesce(trim(p_release_number), '') = '' then raise exception 'Release number is required to complete the request.'; end if;
  update requests set status = 'in_process', release_number = trim(p_release_number),
         promise_date = nullif(p_promise_date, '')::date, release_status = 'in_process' where id = p_request_id;
  perform notify_user(u, 'request_completed',
    format('Request %s is now in process. Release %s.', r.request_number, trim(p_release_number)), r.id)
  from (select distinct unnest(array[r.engineer_id, r.supervisor_id]) as u) x;
end $$;

-- Mark approved. The promise date becomes 30 working days from today; it stays editable in release tracking.
create or replace function public.approve_final(p_request_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare r requests; d date := add_working_days(current_date, 30);
begin
  select * into r from requests where id = p_request_id for update;
  if r.id is null then raise exception 'Request not found.'; end if;
  if not can_view_request(r.engineer_id, r.supervisor_id) then raise exception 'You do not have access to this request.'; end if;
  if r.status <> 'in_process' then raise exception 'Only a request that is in process can be marked approved.'; end if;
  update requests set status = 'approved', release_status = 'approved', promise_date = d where id = p_request_id;
  perform notify_user(u, 'request_final_approved',
    format('Request %s is approved. Promise date %s. The release email is ready.', r.request_number, to_char(d, 'DD Mon YYYY')), r.id)
  from (select distinct unnest(array[r.engineer_id, r.supervisor_id]) as u) x;
  perform _maybe_close(p_request_id);   -- parts may already be received
end $$;

-- Bring an archived request back to the working lists (clinical engineer or administrator).
create or replace function public.unarchive_request(p_request_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (is_admin() or is_clinical()) then raise exception 'Only a clinical engineer (or an admin) can restore an archived request.'; end if;
  update requests set archived = false where id = p_request_id;
  if not found then raise exception 'Request not found.'; end if;
end $$;

-- Link received lines to an MRR number (clinical engineer or administrator).
-- An MRR number that already exists on this request gets the new lines added to it.
create or replace function public.create_mrr(p_request_id bigint, p_mrr_number text, p_mrr_date text, p_receipt_ids bigint[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare r requests; m mrrs; n integer; d date;
begin
  if not (is_admin() or is_clinical()) then raise exception 'Only a clinical engineer (or an admin) can record an MRR.'; end if;
  select * into r from requests where id = p_request_id;
  if r.id is null then raise exception 'Request not found.'; end if;
  if coalesce(trim(p_mrr_number), '') = '' then raise exception 'MRR number is required.'; end if;
  if p_receipt_ids is null or cardinality(p_receipt_ids) = 0 then raise exception 'Select at least one received line.'; end if;
  d := coalesce(nullif(p_mrr_date, '')::date, current_date);
  select count(*) into n from request_receipts
    where id = any(p_receipt_ids) and request_id = p_request_id and mrr_id is null;
  if n <> cardinality(p_receipt_ids) then
    raise exception 'Some of the selected lines are not on this request or already have an MRR. Reopen the list and try again.';
  end if;
  select * into m from mrrs where lower(mrr_number) = lower(trim(p_mrr_number));
  if m.id is not null and m.request_id <> p_request_id then
    raise exception 'MRR % is already used on another request.', trim(p_mrr_number);
  end if;
  if m.id is null then
    insert into mrrs(request_id, mrr_number, mrr_date, created_by)
      values (p_request_id, trim(p_mrr_number), d, auth.uid()) returning * into m;
  end if;
  update request_receipts set mrr_id = m.id where id = any(p_receipt_ids);
  perform _maybe_close(p_request_id);
  perform notify_user(u, 'mrr_recorded',
    format('MRR %s was recorded for request %s.', m.mrr_number, r.request_number), r.id)
  from (select distinct unnest(array[r.engineer_id, r.supervisor_id]) as u) x where u <> auth.uid();
  return jsonb_build_object('mrr_id', m.id, 'mrr_number', m.mrr_number, 'lines', n);
end $$;


-- Rename a position or a specialty and carry the new name to every contact that uses it.
create or replace function public.rename_contact_option(p_kind text, p_old text, p_new text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (is_admin() or is_supervisor()) then raise exception 'Not permitted.'; end if;
  if coalesce(trim(p_new), '') = '' then raise exception 'Name is required.'; end if;
  if p_kind = 'position' then
    update contact_positions set name = trim(p_new) where name = p_old;
    update vendor_contacts set position = trim(p_new) where position = p_old;
  elsif p_kind = 'specialty' then
    update contact_specialties set name = trim(p_new) where name = p_old;
    update vendor_contacts set specialties = array_replace(specialties, p_old, trim(p_new)) where p_old = any(specialties);
  else
    raise exception 'Unknown list.';
  end if;
end $$;

create or replace function public.mark_received(p_item_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare it request_items;
begin
  select * into it from request_items where id = p_item_id;
  if it.id is null then raise exception 'Item not found.'; end if;
  if it.quantity - it.received_quantity > 0 then
    perform receive_items(p_item_id, it.quantity - it.received_quantity);
  end if;
end $$;

create or replace function public.archive_request(p_request_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare r requests;
begin
  select * into r from requests where id = p_request_id;
  if r.id is null then raise exception 'Request not found.'; end if;
  if not can_view_request(r.engineer_id, r.supervisor_id) then raise exception 'You do not have permission to archive this request.'; end if;
  if r.status <> 'closed' then raise exception 'Only a fully received (closed) request can be archived.'; end if;
  update requests set archived = true where id = p_request_id;
end $$;

-- ---------------------------------------------------------------------
-- 8. Privileges: signed-in users only, nothing for anonymous visitors
-- ---------------------------------------------------------------------
do $$
declare t text; f record;
begin
  foreach t in array array['profiles','team_memberships','vendors','vendor_contacts','contact_positions','contact_specialties',
                           'mrrs','request_receipts','contracts','contract_items','requests',
                           'request_items','notifications','audit_log','app_settings','contract_balances'] loop
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;

  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('is_active_user','is_admin','is_clinical','is_supervisor','on_team_of',
               'can_view_request','contract_remaining','check_duplicates','submit_request','update_request',
               'cancel_request','resubmit_request','return_request','decide_request','complete_request',
               'approve_final','update_tracking','receive_items','receive_all','mark_received',
               'archive_request','unarchive_request','create_mrr','delete_mrr','rename_contact_option',
               'receive_lines','cancel_receipt','add_working_days','_sync_vat',
               -- internal helpers: never callable from the browser
               '_validate_items','_insert_items','_vat_for','_maybe_close','notify_user','notify_clinical_pool',
               'handle_new_user','audit_trigger') loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    if f.proname not in ('_validate_items','_insert_items','_vat_for','_maybe_close','_sync_vat','notify_user',
                         'notify_clinical_pool','handle_new_user','audit_trigger') then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;

grant usage on schema public to authenticated;

-- ---------------------------------------------------------------------
-- 9. Storage bucket for part images (public read, admin/supervisor write)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('part-images', 'part-images', true)
on conflict (id) do update set public = true;

drop policy if exists "part images read"   on storage.objects;
drop policy if exists "part images insert" on storage.objects;
drop policy if exists "part images update" on storage.objects;
drop policy if exists "part images delete" on storage.objects;

create policy "part images read" on storage.objects for select to authenticated
  using (bucket_id = 'part-images');
create policy "part images insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'part-images' and (public.is_admin() or public.is_supervisor()));
create policy "part images update" on storage.objects for update to authenticated
  using (bucket_id = 'part-images' and (public.is_admin() or public.is_supervisor()))
  with check (bucket_id = 'part-images' and (public.is_admin() or public.is_supervisor()));
create policy "part images delete" on storage.objects for delete to authenticated
  using (bucket_id = 'part-images' and (public.is_admin() or public.is_supervisor()));

-- Make the API pick up the new tables and functions immediately.
notify pgrst, 'reload schema';
