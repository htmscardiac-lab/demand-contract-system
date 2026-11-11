-- Migration 003: vendor directory (contacts) and equipment description on contract lines
-- Run once in Supabase -> SQL Editor (safe to run again). Run migration_002 first.

-- People to contact at a vendor (the vendor directory). The release email goes to their addresses.
create table if not exists public.vendor_contacts (
  id          bigint generated always as identity primary key,
  vendor_id   bigint not null references public.vendors(id) on delete cascade,
  name        text not null check (trim(name) <> ''),
  email       text,
  phone       text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_vendor_contacts_vendor on public.vendor_contacts(vendor_id);

alter table public.contract_items add column if not exists equipment_description text;

-- carry the email already saved on each vendor into the directory (once)
insert into public.vendor_contacts(vendor_id, name, email)
select v.id, v.name, v.contact_email from public.vendors v
where nullif(trim(v.contact_email), '') is not null
  and not exists (select 1 from public.vendor_contacts c where c.vendor_id = v.id);

alter table public.vendor_contacts enable row level security;
drop policy if exists vendor_contacts_select on public.vendor_contacts;
drop policy if exists vendor_contacts_write  on public.vendor_contacts;
create policy vendor_contacts_select on public.vendor_contacts for select to authenticated using (public.is_active_user());
create policy vendor_contacts_write  on public.vendor_contacts for all to authenticated
  using (public.is_admin() or public.is_supervisor()) with check (public.is_admin() or public.is_supervisor());

drop trigger if exists audit_vendor_contacts on public.vendor_contacts;
create trigger audit_vendor_contacts after insert or update or delete on public.vendor_contacts
  for each row execute function public.audit_trigger();

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

do $$
declare t text; f record;
begin
  foreach t in array array['profiles','team_memberships','vendors','vendor_contacts','contracts','contract_items','requests',
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
