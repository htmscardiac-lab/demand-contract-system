-- Migration 002: VAT as its own contract line
-- Run once in Supabase -> SQL Editor (safe to run again). Run migration_001 first if you have not.
--
--  * contracts get a VAT line number and a VAT line value
--  * a request adds the VAT line automatically: 15% of its taxable parts,
--    quantity = VAT amount / VAT line value (4 decimals)
--  * VAT is part of the request total and is deducted from the contract balance
--  * the VAT line is received like a part before the request closes

-- The balances view reads request_items.quantity, so it is dropped here and
-- recreated in section 3 after the column types are changed.
drop view if exists public.contract_balances;

alter table public.contract_items add column if not exists device_model text;
alter table public.contract_items add column if not exists taxable boolean not null default false;
alter table public.request_items  add column if not exists taxable boolean not null default false;

alter table public.contracts add column if not exists vat_line_number integer;
alter table public.contracts add column if not exists vat_line_value numeric(14,2) check (vat_line_value > 0);
alter table public.request_items add column if not exists is_vat boolean not null default false;
alter table public.request_items alter column contract_item_id drop not null;
alter table public.request_items alter column quantity type numeric(14,4);
alter table public.request_items alter column received_quantity type numeric(14,4);
alter table public.request_items drop constraint if exists request_items_quantity_check;
alter table public.request_items add constraint request_items_quantity_check check (quantity > 0);

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
         coalesce(trim(it->>'equipment_description'), ''),
         -- model comes from the contract line; a value typed on the request only fills a blank
         coalesce(nullif(trim(ci.device_model), ''), trim(it->>'device_model'), ''),
         ci.taxable
  from jsonb_array_elements(p_items) with ordinality as x(it, ord)
  join contract_items ci on ci.id = (it->>'contract_item_id')::bigint and ci.contract_id = p_contract_id
  order by ord;

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
  perform _maybe_close(r.id);
  return jsonb_build_object('received', nv, 'outstanding', it.quantity - nv, 'fully_received', nv >= it.quantity);
end $$;

do $$
declare t text; f record;
begin
  foreach t in array array['profiles','team_memberships','vendors','contracts','contract_items','requests',
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
               'archive_request','unarchive_request',
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
