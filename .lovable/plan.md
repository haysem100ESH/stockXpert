# Fix: Transfer fulfillment not moving stock

## Diagnosis

The edge function `manage-transfer-request` (action `fulfill`) issues many separate `supabase.from(...).update(...)` / `insert(...)` calls **without ever checking the returned `error`**. It then unconditionally flips `transfer_requests.status` to `fulfilled`.

Because:

- Both `inventory_batches` and `branch_items` stay unchanged after a transfer (you confirmed this), and
- `transfer_requests` + `transfer_request_items` *do* update,

…the writes against the stock tables are almost certainly being **silently rejected** by a Postgres trigger / check constraint (your project memory says: *"Direct stock quantity editing is forbidden; must use Adjust Stock"* — that rule is typically enforced by a `BEFORE UPDATE` trigger on `branch_items`, and a related guard often exists on `inventory_batches`). The service role bypasses RLS but **does not bypass triggers**. The errors are swallowed because the code never reads `.error`.

## Fix strategy

Replace the JS-side stock manipulation with a single `SECURITY DEFINER` Postgres function executed in one transaction. Benefits:

1. Atomic — either everything moves (batches + branch_items + expenses) or nothing does.
2. `SECURITY DEFINER` runs as the function owner, and we can `SET LOCAL "app.transfer_context" = 'true'` (or use `pg_trigger_depth()` / a session flag the guard trigger already checks, if it exists) to legitimately bypass the "no direct quantity edit" guard for this trusted operation.
3. Any failure raises an exception → the edge function returns 500 with the real Postgres message instead of pretending success.

## Changes

### 1. New migration: `fulfill_transfer_request(p_request_id uuid, p_user_id uuid)`

A PL/pgSQL function that:

- Locks the `transfer_requests` row (`FOR UPDATE`), validates status = `approved`.
- Resolves `requesting_location_id` / `source_location_id` → branch ids.
- Loops over `transfer_request_items`:
  - Looks up source `branch_items` row, asserts sufficient quantity.
  - FIFO-deducts from `inventory_batches` (`branch_item_id = source_bi.id`, ordered by expiry, then created_at), with legacy fallback by `(branch_id, medicine_id)` and backfills `branch_item_id`.
  - Computes weighted average purchase price for the moved qty.
  - Upserts destination `branch_items` row (creates if missing).
  - Applies destination batching per item flags: `target_batch_id`, `create_new_batch` (`new_batch_number`, `new_batch_expiry`, `new_batch_purchase_price`), else clones consumed source batches.
  - Recomputes `branch_items.quantity = SUM(remaining_quantity)` for both source and destination (or directly adjusts when no batches exist).
  - Inserts paired `expenses` rows (`-totalCost` on source, `+totalCost` on destination, category `Stock Transfer`).
- Sets `transfer_requests.status = 'fulfilled'`.
- Wraps the body in `BEGIN ... EXCEPTION WHEN OTHERS THEN RAISE; END;` (no swallowing).
- Marks the session with `PERFORM set_config('app.transfer_context', 'on', true);` at the top so any guard trigger on `branch_items` / `inventory_batches` can whitelist this path. (If no such trigger exists, the SET is a harmless no-op.)
- `GRANT EXECUTE ... TO authenticated, service_role`.

### 2. Update `supabase/functions/manage-transfer-request/index.ts`

For the `fulfill` action only:

- Remove the long manual block (lines ~116–429 of stock work).
- Replace with:
  ```ts
  const { error } = await admin.rpc('fulfill_transfer_request', {
    p_request_id: requestId,
    p_user_id: user.id,
  });
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  ```
- Keep `approve` / `reject` paths as-is, but add `.error` checks on their `update` calls and return 500 on failure (so the UI stops saying "success" when nothing happened).

### 3. Trigger discovery step (one read-only migration first)

Before writing the RPC, the first migration is a small **diagnostic**: it queries `pg_trigger` / `pg_policies` on `branch_items` and `inventory_batches` and `RAISE NOTICE`s the names + definitions. Reviewing this lets us decide whether to:

- (a) call an existing whitelist mechanism (e.g. setting `app.bypass_stock_guard`), or
- (b) modify the guard trigger to accept `current_setting('app.transfer_context', true) = 'on'`.

We'll commit the guard-aware version of the RPC after that one-shot inspection.

### 4. Frontend

No changes required — `TransferRequestList` already calls `manage-transfer-request` and shows the returned error toast. Errors will now actually surface.

## Files touched

- `supabase/migrations/<ts>_inspect_stock_guards.sql` (notice-only, single transaction)
- `supabase/migrations/<ts>_fulfill_transfer_request.sql` (the RPC, possibly accompanied by an `ALTER FUNCTION` on the existing guard trigger to honor `app.transfer_context`)
- `supabase/functions/manage-transfer-request/index.ts` (slim down fulfill, add error checks)

## Verification

After deploy, run a real transfer and confirm in DB:

1. `inventory_batches.remaining_quantity` decreases on source and an equivalent batch appears/grows on destination.
2. `branch_items.quantity` on both branches reflects the new `SUM(remaining_quantity)`.
3. Two `expenses` rows (`-x`, `+x`) appear under category `Stock Transfer`.
4. Forcing a failure (e.g. transfer more than available) returns a visible error toast and **does not** flip `status` to `fulfilled`.
