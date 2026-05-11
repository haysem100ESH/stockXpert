## Advanced Multi-Level Packaging & Measurement System

This is a major architectural change. Before I start writing code, I want to confirm scope and a phased approach so we don't break the existing FIFO batches, sales, and pharmacy features.

### Current state (what already exists)
- `medicines` table already has: `item_type` (`full_pcs` / `measurable`), `unit_label` (kg, g, l, ml, etc.), `units_per_pack`, `strips_per_pack`, `units_per_strip`.
- Sales already support **Full Pack** vs **By Strip/Unit**, plus measurable decimal quantities.
- FIFO batches via `inventory_batches` (per branch_item).
- CSV import exists in `ImportCsvDialog.tsx`.
- Smart Inventory analytics exist (`useSmartInventory`, demand, dead stock, etc.).

So ~60% of what you described is already in the system, just under different names and only 2 levels deep (Pack → Strip), not 3 levels (Pack → Strip → Sub-strip/Tablet).

### What's actually new
1. **Packaging mode** free-text label (Bottle / Pack / Box / Carton / Sachet / Tube / Roll / Bag).
2. **3rd hierarchy level** — sub-units (e.g. Pack → Strip → Tablet), today we only have 2 (Pack → Strip).
3. **3-tier pricing** — pack price, strip price, sub-unit price (today: pack price + derived strip price).
4. **Sales UI** — third option "Sell by sub-unit".
5. **CSV template** — new columns for the above.
6. **Analytics** — best-selling sub-units, most profitable packaging level.

### Proposed Plan (phased, non-breaking)

**Phase 1 — Schema (migration)**
Add nullable columns to `medicines` (defaults preserve existing behavior):
```
packaging_mode        text          -- "Pack", "Bottle", "Carton", free text
sub_units_per_unit    integer       -- e.g. 5 tablets per strip
main_unit_name        text          -- "Pack" (display label)
sub_unit_name         text          -- "Tablet" (display label)
unit_price            numeric       -- explicit strip price (overrides derived)
sub_unit_price        numeric       -- explicit sub-unit price
```
`is_measurable` already covered by `item_type='measurable'`. `measurement_unit` = existing `unit_label`. `total_measurement_amount` = existing `quantity` on `branch_items`.

Existing `units_per_pack` stays as "units/strips per pack". No data migration needed — old items continue working as 2-level.

**Phase 2 — Add/Edit Item dialogs**
- New "Packaging Mode" combobox (free text + suggestions).
- New collapsible "Advanced packaging" section: sub-unit name, sub-units per unit, sub-unit price.
- Validation: if `sub_units_per_unit > 0` then `sub_unit_name` and `sub_unit_price` required.

**Phase 3 — CSV import/export template**
Add new optional columns; old templates still parse correctly.

**Phase 4 — Sales (Add to Cart dialog)**
Third sale type option `by_sub_unit` shown only when `sub_units_per_unit > 0`. Stock deduction:
`total_sub_units_available = stock_packs * units_per_pack * sub_units_per_unit + open_pack_units * sub_units_per_unit + open_strip_sub_units`. We'll add an `open_strip_sub_units` counter on `branch_items` to track partial strips, mirroring how `open_pack_units` works today.

**Phase 5 — UI display**
`MedicineInfoDialog` and inventory cards show full hierarchy + 3-tier pricing.

**Phase 6 — Analytics**
Extend `useSmartInventory` to break down sales by level (pack / strip / sub-unit) and surface "most profitable packaging level".

### Technical notes
- FIFO: untouched. Batches still track `quantity_remaining` in pack units; sub-unit deductions roll up.
- RLS: new columns inherit existing `medicines` policies.
- Backward compatibility: every new field is nullable; absence = current 2-level behavior.

### Questions before I build

This is roughly **6–10 hours** of work across 15+ files. To keep it shippable I'd like to do it in **two PRs**:

1. **PR1 (this turn):** Phase 1–3 (schema + Add/Edit dialog + CSV template). Item creation works end-to-end with sub-units; sales still uses existing 2-level flow.
2. **PR2 (next turn):** Phase 4–6 (sales sub-unit selling + analytics + info dialog redesign).

Reply **"go"** to proceed with PR1 as described, or tell me which phases to reorder/skip.
