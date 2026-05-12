-- ============================================================================
-- Cursor (Keyset) Pagination Indexes
-- ----------------------------------------------------------------------------
-- These composite indexes power O(log N) keyset pagination over (created_at, id)
-- partitioned by the most-common equality filter (branch_id / customer_id /
-- supplier_id). They replace OFFSET-based pagination, which becomes O(N) at
-- deep pages on 5M+ row tables.
--
-- Run each statement individually in the Supabase SQL editor — CONCURRENTLY
-- cannot run inside a transaction block. Safe to re-run (IF NOT EXISTS).
-- ============================================================================

-- Sales feed (Sales page, Finance page, Customer ledger)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sales_keyset_branch
  ON public.sales (branch_id, created_at DESC, id DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sales_keyset_customer
  ON public.sales (customer_id, created_at DESC, id DESC)
  WHERE customer_id IS NOT NULL;

-- Sale items (Smart Inventory demand, top products)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sale_items_keyset_medicine
  ON public.sale_items (medicine_id, created_at DESC, id DESC);

-- Branch inventory list (Inventory page virtual scroll)
-- For inventory we paginate by name since it is the natural sort order.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_branch_items_keyset_branch
  ON public.branch_items (branch_id, id DESC);

-- Stock movements / batches feed
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inventory_batches_keyset_branch
  ON public.inventory_batches (branch_id, created_at DESC, id DESC);

-- Customer & supplier lists
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customers_keyset_branch
  ON public.customers (branch_id, created_at DESC, id DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_suppliers_keyset_branch
  ON public.suppliers (branch_id, created_at DESC, id DESC);

-- Credit logs (Finance / Customer ledger)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_credit_logs_keyset_customer
  ON public.credit_logs (customer_id, created_at DESC, id DESC);

ANALYZE public.sales;
ANALYZE public.sale_items;
ANALYZE public.branch_items;
ANALYZE public.inventory_batches;
ANALYZE public.customers;
ANALYZE public.suppliers;
ANALYZE public.credit_logs;

-- ============================================================================
-- High-performance RPC: server-side join + projection for the Sales feed.
-- Returns a lean JSON shape per row so the client does zero post-processing.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.sales_feed_page(
  _branch_id uuid,
  _cursor_ts timestamptz DEFAULT NULL,
  _cursor_id uuid       DEFAULT NULL,
  _limit     int        DEFAULT 50
)
RETURNS TABLE (
  id              uuid,
  created_at      timestamptz,
  total_amount    numeric,
  payment_method  text,
  customer_name   text,
  item_count      int
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    s.id,
    s.created_at,
    s.total_amount,
    s.payment_method,
    c.name                            AS customer_name,
    COALESCE(si.item_count, 0)::int   AS item_count
  FROM public.sales s
  LEFT JOIN public.customers c ON c.id = s.customer_id
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS item_count
    FROM public.sale_items
    WHERE sales_id = s.id
  ) si ON true
  WHERE s.branch_id = _branch_id
    AND (
      _cursor_ts IS NULL
      OR s.created_at < _cursor_ts
      OR (s.created_at = _cursor_ts AND s.id < _cursor_id)
    )
  ORDER BY s.created_at DESC, s.id DESC
  LIMIT _limit;
$$;

-- Allow the anon/authenticated roles to call it (subject to RLS on base tables).
GRANT EXECUTE ON FUNCTION public.sales_feed_page(uuid, timestamptz, uuid, int)
  TO anon, authenticated;
