-- Migration: device model and VAT flag on contract line items
-- Run once in Supabase -> SQL Editor (safe to run again).

alter table public.contract_items add column if not exists device_model text;
alter table public.contract_items add column if not exists taxable boolean not null default false;
alter table public.request_items  add column if not exists taxable boolean not null default false;

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
  order by ord
$$;

notify pgrst, 'reload schema';
