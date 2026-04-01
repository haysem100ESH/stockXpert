## Phase 1: Database Schema
1. Create `inventory_batches` table (branch_id, medicine_id, supplier_id, batch_number, quantity, remaining_quantity, purchase_price, selling_price, expiry_date, created_by)
2. Create `sale_item_batches` table (sale_item_id, batch_id, quantity)
3. Add RLS policies for both tables

## Phase 2: Core Inventory Logic
4. Update "Add Item to Branch" flow → always create a new `inventory_batches` row
5. Update `branch_items.quantity` to sync as `SUM(remaining_quantity)` from batches
6. Update supplier purchase recording to create batches + link supplier_id
7. Update expense tracking to record per-batch expenses

## Phase 3: FIFO Selling
8. Update `SalesManagement` / `CartSlider` checkout logic:
   - Fetch batches ordered by `expiry_date ASC NULLS LAST, created_at ASC`
   - Deduct from oldest batches first (FIFO)
   - Insert `sale_item_batches` records for audit trail
   - Sync `branch_items.quantity` after sale

## Phase 4: Profit Calculation
9. Update profit calculations to use actual batch purchase_price × quantity sold from each batch (instead of average cost)

## Phase 5: UI Updates
10. Add "Batch Breakdown" view when clicking an inventory item (show all batches with remaining qty, expiry, cost)
11. Update dashboard expiry alerts to query `inventory_batches` instead of `branch_items`
12. Update low stock alerts to use `SUM(remaining_quantity)` from batches
13. Update Smart Inventory hooks to use batch data

## Phase 6: Analytics
14. Add Batch Profit Report (profit per batch, best/worst batches, expiry losses)

## Important Constraints
- Don't break existing system — batch system layers on top
- General inventory items: expiry_date is optional, FIFO uses created_at
- All existing sales/inventory flows must continue working
- branch_items becomes a summary/cache table

## Risk Notes
- This is ~15+ file changes across migrations, hooks, components
- Requires careful testing of FIFO edge cases
- Existing data needs migration strategy (current branch_items → initial batches)