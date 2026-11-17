-- ============================================================================
-- NR Industries — 0029_inventory_perf.sql
--
-- Speed for the Inventory module. ADDITIVE ONLY: one new read function and
-- two new indexes, on inv_ objects. Nothing existing is altered or replaced
-- (inv_overview and every other 0028 function stay exactly as they are), no
-- row is written, and the figures follow the same rules as 0028:
--   opening  = opening_qty + Σ delta of entries before the month
--   received = Σ delta of the month's receipts (reversals net out)
--   issued   = − Σ delta of the month's issues
--   balance  = opening + received − issued
-- A closed month is read from its snapshots, exactly like inv_overview.
-- ============================================================================

begin;

-- one product's ledger, newest first (inv_product_history orders by id)
create index if not exists inv_transactions_product_id_desc
  on public.inv_transactions (product_id, id desc);
-- a closed month's snapshot rows (the admin month selector)
create index if not exists inv_month_snapshots_month
  on public.inv_month_snapshots (month);

-- The main page's data, compact: field names once, every product as an
-- array in that order, numbers as plain decimal text without trailing zeros.
-- Trend and top 10 only when asked AND the caller is admin tier (the only
-- ones who see them), so the page can ask before it knows the role. `ledger_seq` is
-- the newest ledger entry the figures include, so the screen can tell
-- whether an entry it just saved is already counted.
-- SECURITY INVOKER: RLS applies, like inv_overview; it also closes ended
-- months first (inv_rollover), like inv_overview.
create or replace function public.inv_page(p_month date default null, p_analytics boolean default false)
returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare
  v_today date := public.inv_today();
  v_cur   date := date_trunc('month', public.inv_today())::date;
  v_month date := date_trunc('month', coalesce(p_month, public.inv_today()))::date;
  v_past  boolean;
  v_rows  jsonb;
  v_stats boolean;
begin
  if not public.inv_can_view() then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  v_stats := coalesce(p_analytics, false) and public.current_role_name()::text in ('head_admin', 'admin');
  perform public.inv_rollover();

  v_past := v_month < v_cur and exists (select 1 from public.inv_closed_months where month = v_month);
  if not v_past then v_month := v_cur; end if;

  if v_past then
    select coalesce(jsonb_agg(jsonb_build_array(
             p.id, p.serial_no, p.description, p.specification, trim_scale(p.rate)::text, p.custom, p.is_active,
             trim_scale(s.opening)::text, trim_scale(s.received)::text, trim_scale(s.issued)::text, trim_scale(s.closing)::text)
           order by p.serial_no), '[]'::jsonb)
      into v_rows
      from public.inv_month_snapshots s
      join public.inv_products p on p.id = s.product_id
     where s.month = v_month;
  else
    select coalesce(jsonb_agg(jsonb_build_array(
             p.id, p.serial_no, p.description, p.specification, trim_scale(p.rate)::text, p.custom, p.is_active,
             trim_scale(p.opening_qty + x.before)::text, trim_scale(x.received)::text, trim_scale(x.issued)::text,
             trim_scale(p.opening_qty + x.before + x.received - x.issued)::text)
           order by p.serial_no), '[]'::jsonb)
      into v_rows
      from public.inv_products p
      left join lateral (
        select coalesce(sum(t.delta) filter (where t.entry_date < v_cur), 0) as before,
               coalesce(sum(t.delta) filter (where t.entry_date >= v_cur and t.kind = 'receive'), 0) as received,
               coalesce(-(sum(t.delta) filter (where t.entry_date >= v_cur and t.kind = 'issue')), 0) as issued
          from public.inv_transactions t
         where t.product_id = p.id) x on true;
  end if;

  return jsonb_build_object(
    'today', v_today,
    'current_month', v_cur,
    'month', v_month,
    'is_current', not v_past,
    'ledger_seq', (select coalesce(max(id), 0) from public.inv_transactions),
    'columns', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', c.id, 'key', c.key, 'label', c.label, 'data_type', c.data_type,
                  'position', c.position, 'is_default', c.is_default, 'visible', c.visible,
                  'archived', c.archived_at is not null)
                order by c.is_default desc, c.position), '[]'::jsonb)
                from public.inv_columns c),
    'settings', (select jsonb_build_object('person_name', s.person_name, 'phone', s.phone)
                   from public.inv_settings s where s.id),
    'months', (select coalesce(jsonb_agg(m.month order by m.month desc), '[]'::jsonb)
                 from public.inv_closed_months m),
    'fields', jsonb_build_array('id', 'serial_no', 'description', 'specification', 'rate', 'custom', 'is_active',
                                'opening', 'received', 'issued', 'balance'),
    'rows', v_rows,
    'trend', case when v_stats then (
               select coalesce(jsonb_agg(jsonb_build_object(
                        'month', z.m, 'received', trim_scale(z.received)::text, 'issued', trim_scale(z.issued)::text)
                      order by z.m), '[]'::jsonb)
                 from (select g.m::date as m,
                              coalesce(sum(t.delta) filter (where t.kind = 'receive'), 0) as received,
                              coalesce(-(sum(t.delta) filter (where t.kind = 'issue')), 0) as issued
                         from generate_series((v_month - interval '5 months')::date, v_month, interval '1 month') g(m)
                         left join public.inv_transactions t
                           on t.entry_date >= g.m::date and t.entry_date < (g.m + interval '1 month')::date
                        group by g.m) z
             ) end,
    'top_issued', case when v_stats then (
               select coalesce(jsonb_agg(jsonb_build_object(
                        'id', q.id, 'serial_no', q.serial_no, 'description', q.description,
                        'specification', q.specification, 'issued', trim_scale(q.issued)::text)
                      order by q.issued desc, q.serial_no), '[]'::jsonb)
                 from (select p.id, p.serial_no, p.description, p.specification, -sum(t.delta) as issued
                         from public.inv_transactions t
                         join public.inv_products p on p.id = t.product_id
                        where t.kind = 'issue' and t.entry_date >= v_month
                          and t.entry_date < (v_month + interval '1 month')::date
                        group by p.id
                       having -sum(t.delta) > 0
                        order by issued desc, p.serial_no
                        limit 10) q
             ) end
  );
end $$;

revoke all on function public.inv_page(date, boolean) from public, anon;
grant execute on function public.inv_page(date, boolean) to authenticated, service_role;

commit;
