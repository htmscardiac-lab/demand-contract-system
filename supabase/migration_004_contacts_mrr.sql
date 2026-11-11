-- Migration 004: contact details in the vendor directory, receipts log and MRR
-- Run once in Supabase -> SQL Editor (safe to run again). Run migration_003 first.

alter table public.vendor_contacts add column if not exists position text;
alter table public.vendor_contacts add column if not exists specialties text[] not null default '{}';

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

create index if not exists idx_receipts_request on public.request_receipts(request_id);
create index if not exists idx_receipts_mrr on public.request_receipts(mrr_id);
create index if not exists idx_mrrs_request on public.mrrs(request_id);

-- lines received before this migration get one receipt each, so they can be linked to an MRR (once)
insert into public.request_receipts(request_id, request_item_id, quantity, received_at, received_by)
select ri.request_id, ri.id, ri.received_quantity, coalesce(ri.received_at, now()), ri.received_by
from public.request_items ri
where ri.received_quantity > 0
  and not exists (select 1 from public.request_receipts x where x.request_item_id = ri.id);

alter table public.contact_positions   enable row level security;
alter table public.contact_specialties enable row level security;
alter table public.mrrs                enable row level security;
alter table public.request_receipts    enable row level security;
drop policy if exists contact_positions_select on public.contact_positions;
drop policy if exists contact_positions_write on public.contact_positions;
drop policy if exists contact_specialties_select on public.contact_specialties;
drop policy if exists contact_specialties_write on public.contact_specialties;
drop policy if exists receipts_select on public.request_receipts;
drop policy if exists mrrs_select on public.mrrs;
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

do $$
declare t text;
begin
  foreach t in array array['contact_positions','contact_specialties','mrrs','request_receipts'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$s', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$s
                    for each row execute function public.audit_trigger()', t);
  end loop;
end $$;

create or replace function public._maybe_close(p_request_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare r requests;
begin
  -- a request closes when every line is fully received and every receipt is covered by an MRR
  if exists (select 1 from request_items where request_id = p_request_id and received_quantity < quantity) then return; end if;
  if exists (select 1 from request_receipts where request_id = p_request_id and mrr_id is null) then return; end if;
  select * into r from requests where id = p_request_id and status = 'approved';
  if r.id is null then return; end if;
  update requests set status = 'closed' where id = p_request_id;
  perform notify_user(u, 'items_received',
    format('Request %s is fully received, covered by MRR, and closed.', r.request_number), r.id)
  from (select distinct unnest(array[r.engineer_id, r.supervisor_id]) as u) x;
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
  if r.status not in ('in_process','approved','closed') then
    raise exception 'Items can only be received on processed requests.';
  end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Received quantity must be more than zero.'; end if;
  if not it.is_vat and p_quantity <> trunc(p_quantity) then raise exception 'Parts are received in whole units.'; end if;
  nv := it.received_quantity + p_quantity;
  if nv > it.quantity then
    raise exception 'Received quantity (%) would exceed the requested quantity (%). Outstanding: %.',
      nv, it.quantity, it.quantity - it.received_quantity;
  end if;
  update request_items set received_quantity = nv,
         received_at = case when nv >= it.quantity then now() else null end,
         received_by = auth.uid()
   where id = p_item_id;
  insert into request_receipts(request_id, request_item_id, quantity, received_by)
    values (r.id, p_item_id, p_quantity, auth.uid());
  perform _maybe_close(r.id);
  return jsonb_build_object('received', nv, 'outstanding', it.quantity - nv, 'fully_received', nv >= it.quantity);
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

-- Remove an MRR entered by mistake; its lines go back to "received, no MRR".
create or replace function public.delete_mrr(p_mrr_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare rid bigint;
begin
  if not (is_admin() or is_clinical()) then raise exception 'Only a clinical engineer (or an admin) can remove an MRR.'; end if;
  delete from mrrs where id = p_mrr_id returning request_id into rid;
  if rid is null then raise exception 'MRR not found.'; end if;
  -- its lines have no MRR again, so a closed request goes back to approved until they are covered
  update requests set status = 'approved', archived = false where id = rid and status = 'closed';
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
               -- internal helpers: never callable from the browser
               '_validate_items','_insert_items','_vat_for','_maybe_close','notify_user','notify_clinical_pool',
               'handle_new_user','audit_trigger') loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    if f.proname not in ('_validate_items','_insert_items','_vat_for','_maybe_close','notify_user',
                         'notify_clinical_pool','handle_new_user','audit_trigger') then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;

grant usage on schema public to authenticated;

notify pgrst, 'reload schema';
