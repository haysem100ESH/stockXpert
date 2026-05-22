# Batch Management System — Implementation Plan

## 1. Data migration (existing stock → default batches)
- New SQL migration: for every `branch_items` row with `quantity > 0` and no existing `inventory_batches`, insert one default batch using current `quantity`, `purchase_price`, `selling_price`, `expiry_date` (and `batch_number = 'DEFAULT'`). Run via migration tool.
- After migration, `branch_items.quantity` continues to be kept in sync via `syncBranchItemQuantity` (already exists in `src/lib/batchInventory.ts`).

## 2. Edit Item dialog — add "Batches" tab
File: `src/components/inventory/EditBranchItemDialog.tsx`
- Wrap content in `<Tabs>` with two triggers: **Item Info** (current form, expiry already hidden) and **Batches**.
- Batches tab: editable table of `inventory_batches` for this `branch_item_id`:
  - columns: Batch #, Stock Qty, Buy Price, Sell Price, Expiry, Delete
  - "+ Add Batch" button (pre-fills buy/sell from item defaults)
  - On save, upsert/delete batches, then call `syncBranchItemQuantity`
  - Shows read-only "Total stock = Σ batches" badge
- Disable direct `quantity` field on Item Info tab (read-only, shows computed total).

## 3. Per-batch expiry dialog
- New `src/components/inventory/SelectBatchForExpiryDialog.tsx`: lists batches with current expiry, allows picking one and updating its `expiry_date`.
- Wire into any UI that currently exposes "edit expiry" on an item (search `expiry_date` edit callers in inventory list/staff view).

## 4. Excel upload — multi-batch rows
File: `src/components/inventory/ImportCsvDialog.tsx`
- Parser change: when a row's item-name/identifier column is empty, treat it as a continuation batch for the most recent parent row. Capture per-batch fields: batch number, buy price, sell price, stock qty, min stock, expiry.
- On import: for the parent row → create/find medicine + `branch_item` (qty starts 0); for each batch row (parent + continuations) → call `createBatch(...)` which auto-syncs total.
- Template download: update header comments/legend to explain continuation-row format and highlight batch-only columns.

## 5. Inventory list — batch count badge
Files: `src/components/inventory/InventoryManagement.tsx`, `StaffInventoryView.tsx`, `StaffInventoryWithActions.tsx`
- Fetch batch counts per `branch_item_id` (single grouped query) and show a small "{n} batches" badge next to item name. Clicking opens existing `BatchBreakdownDialog`.

## 6. Sales / FEFO
- Already implemented: `getFIFOBatches` orders by `expiry_date ASC NULLS LAST, created_at ASC` and `deductFIFO` uses it. No change needed; verify after migration.

## Out of scope
- No schema changes (table already supports everything).
- No change to POS/sales business logic beyond confirming FEFO still works.

## Technical notes
- Keep `branch_items.purchase_price/selling_price/expiry_date` as display defaults (don't drop columns).
- All batch mutations go through `src/lib/batchInventory.ts` so `quantity` stays consistent.
- Migration uses `INSERT ... SELECT ... WHERE NOT EXISTS` so re-runs are safe.
