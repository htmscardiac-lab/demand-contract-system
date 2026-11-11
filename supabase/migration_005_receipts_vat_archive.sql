-- Migration 005: receipt submission and log, automatic VAT receipt, Complete / Archived,
-- return notes per line, promise date 30 working days after approval, lines in contract line order.
-- Run once in Supabase -> SQL Editor (safe to run again). Run migration_004 first.

alter table public.requests add column if not exists return_notes jsonb;

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

-- ---- existing data ----
-- the VAT line no longer has receipts of its own; its received quantity follows the taxed parts
delete from public.request_receipts x using public.request_items i where i.id = x.request_item_id and i.is_vat;
select public._sync_vat(r.id) from public.requests r
 where exists (select 1 from public.request_items i where i.request_id = r.id and i.is_vat);
-- approved requests whose parts are all received become Complete
update public.requests r set status = 'closed'
 where r.status = 'approved'
   and exists (select 1 from public.request_items i where i.request_id = r.id and not i.is_vat)
   and not exists (select 1 from public.request_items i where i.request_id = r.id and not i.is_vat and i.received_quantity < i.quantity);
-- complete requests whose receipts are all covered by an MRR go to the archive
update public.requests r set archived = true
 where r.status = 'closed' and not r.archived
   and exists (select 1 from public.request_receipts x where x.request_id = r.id)
   and not exists (select 1 from public.request_receipts x where x.request_id = r.id and x.mrr_id is null);

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

notify pgrst, 'reload schema';
