-- ============================================================================
-- Smart Inventory: server-side aggregation RPC
-- ----------------------------------------------------------------------------
-- Replaces 3 large client-side fetches (branch_items + 60d sale_items +
-- 365d sale_items) with ONE indexed query that returns ~N rows
-- (one per branch_item) instead of potentially millions of sale_items.
--
-- Returned monthly_qty is an int[12] of qty per calendar month (Jan=0..Dec=11)
-- over the last 365 days, used by the seasonal multiplier.
-- ============================================================================

-- Supporting indexes (transaction-safe). Skips if already present.
CREATE INDEX IF NOT EXISTS idx_sales_smart_inventory_branch_created
  ON public.sales (branch_id, created_at DESC, id);

CREATE INDEX IF NOT EXISTS idx_sale_items_smart_inventory_sale_medicine
  ON public.sale_items (sale_id, medicine_id);

CREATE INDEX IF NOT EXISTS idx_branch_items_branch
  ON public.branch_items (branch_id);

-- ============================================================================
CREATE OR REPLACE FUNCTION public.smart_inventory_summary(_branch_ids uuid[])
RETURNS TABLE (
  branch_item_id       uuid,
  medicine_id          uuid,
  name                 text,
  category             text,
  branch_id            uuid,
  stock_quantity       numeric,
  minimum_stock_level  numeric,
  expiry_date          date,
  selling_price        numeric,
  item_type            text,
  qty_30               numeric,
  qty_60               numeric,
  last_sale_date       timestamptz,
  monthly_qty          int[]
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH
  -- Pre-aggregate sale_items once per medicine over the relevant horizons.
  recent AS (
    SELECT
      s.branch_id,
      si.medicine_id,
      SUM( CASE
             WHEN si.created_at >= now() - interval '30 days'
             THEN COALESCE(NULLIF(COALESCE(si.pack_quantity,0)+COALESCE(si.strip_quantity,0),0), si.quantity, 0)
             ELSE 0
           END ) AS qty_30,
      SUM( COALESCE(NULLIF(COALESCE(si.pack_quantity,0)+COALESCE(si.strip_quantity,0),0), si.quantity, 0) ) AS qty_60,
      MAX(s.created_at) AS last_sale_date
    FROM public.sale_items si
    JOIN public.sales s ON s.id = si.sale_id
    WHERE s.branch_id = ANY(_branch_ids)
      AND s.created_at >= now() - interval '60 days'
    GROUP BY s.branch_id, si.medicine_id
  ),
  monthly AS (
    SELECT
      s.branch_id,
      si.medicine_id,
      EXTRACT(MONTH FROM s.created_at)::int - 1 AS m_idx,
      SUM( COALESCE(NULLIF(COALESCE(si.pack_quantity,0)+COALESCE(si.strip_quantity,0),0), si.quantity, 0) ) AS qty
    FROM public.sale_items si
    JOIN public.sales s ON s.id = si.sale_id
    WHERE s.branch_id = ANY(_branch_ids)
      AND s.created_at >= now() - interval '365 days'
    GROUP BY s.branch_id, si.medicine_id, EXTRACT(MONTH FROM s.created_at)
  ),
  monthly_arr AS (
    SELECT
      branch_id,
      medicine_id,
      ( SELECT array_agg(COALESCE(q.qty, 0)::int ORDER BY g.m)
        FROM generate_series(0,11) g(m)
        LEFT JOIN monthly q
          ON q.branch_id = monthly.branch_id AND q.medicine_id = monthly.medicine_id AND q.m_idx = g.m
      ) AS monthly_qty
    FROM monthly
    GROUP BY branch_id, medicine_id
  )
  SELECT
    bi.id                                  AS branch_item_id,
    bi.medicine_id,
    m.name,
    COALESCE(m.category, 'Uncategorized')  AS category,
    bi.branch_id,
    bi.quantity                            AS stock_quantity,
    COALESCE(m.minimum_stock_level, 0)     AS minimum_stock_level,
    bi.expiry_date,
    bi.selling_price,
    m.item_type,
    COALESCE(r.qty_30, 0)                  AS qty_30,
    COALESCE(r.qty_60, 0)                  AS qty_60,
    r.last_sale_date,
    COALESCE(ma.monthly_qty, ARRAY[0,0,0,0,0,0,0,0,0,0,0,0]) AS monthly_qty
  FROM public.branch_items bi
  JOIN public.medicines m ON m.id = bi.medicine_id
  LEFT JOIN recent      r  ON r.branch_id = bi.branch_id AND r.medicine_id  = bi.medicine_id
  LEFT JOIN monthly_arr ma ON ma.branch_id = bi.branch_id AND ma.medicine_id = bi.medicine_id
  WHERE bi.branch_id = ANY(_branch_ids);
$$;

GRANT EXECUTE ON FUNCTION public.smart_inventory_summary(uuid[])
  TO anon, authenticated;
