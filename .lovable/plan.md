## Overview

Two major restructures across the pharmacy system:
1. **Unit-Based Packaging** — replace fragmented packaging columns with a clean `medicine_packaging` table (unit → strip → pack hierarchy), always store stock as total units.
2. **Medicine Codes** — owner-defined grouping codes to unify variants of the same drug.

This is a high-risk migration touching: `medicines`, `branch_items`, every inventory dialog, POS/sales flow, stock alerts, smart inventory, exports, transfers, and reports.

---

## Phase 1 — Database migrations

### 1a. Create `medicine_packaging`
```sql
CREATE TABLE medicine_packaging (
  id uuid PK,
  medicine_id uuid FK medicines(id) ON DELETE CASCADE UNIQUE,
  unit_name text NOT NULL DEFAULT 'tablet',
  strip_enabled boolean NOT NULL DEFAULT false,
  units_per_strip integer,
  strip_name text,
  pack_enabled boolean NOT NULL DEFAULT false,
  strips_per_pack integer,
  pack_name text,
  unit_selling_price numeric,
  strip_selling_price numeric,
  pack_selling_price numeric,
  CHECK (pack_enabled = false OR strip_enabled = true),
  CHECK (NOT strip_enabled OR units_per_strip > 0),
  CHECK (NOT pack_enabled OR strips_per_pack > 0)
);
```
RLS: owner via `medicines.owner_id` join; staff read-only via branch.

### 1b. Backfill from existing medicines
For every medicine, insert one `medicine_packaging` row:
- `unit_name` ← `unit_label` || 'tablet'
- If `packaging_mode='with_strip'` AND `units_per_strip>0`: `strip_enabled=true`, copy `units_per_strip`, `strips_per_pack` (if >0 set `pack_enabled=true`)
- Prices: `unit_selling_price ← sub_unit_price` (if exists) else null; `strip_selling_price ← unit_price`

### 1c. Normalize stock to total units in `branch_items`
Convert existing `quantity` to total units where strip-mode currently stored strip-count (audit current data first via a query). Same for `inventory_batches.remaining_quantity`.

### 1d. Drop legacy columns from `medicines`
Drop: `units_per_pack, open_pack_units, unit_label, strips_per_pack, units_per_strip, packaging_mode, sub_units_per_unit, main_unit_name, sub_unit_name, unit_price, sub_unit_price, item_type` (after code migration, in a follow-up migration to avoid breaking deploys).

### 1e. Create `medicine_codes`
```sql
CREATE TABLE medicine_codes (
  id uuid PK,
  owner_id uuid FK profiles(id),
  code text NOT NULL,
  label text NOT NULL,
  notes text,
  UNIQUE (owner_id, code)
);
ALTER TABLE medicines ADD COLUMN medicine_code_id uuid REFERENCES medicine_codes(id) ON DELETE SET NULL;
```

---

## Phase 2 — Shared utilities (`src/lib/packaging.ts`)

```ts
export type Packaging = {
  unit_name: string;
  strip_enabled: boolean; units_per_strip?: number; strip_name?: string;
  pack_enabled: boolean; strips_per_pack?: number; pack_name?: string;
  unit_selling_price?: number; strip_selling_price?: number; pack_selling_price?: number;
};
export function convertToUnits(qty: number, level: 'unit'|'strip'|'pack', p: Packaging): number;
export function formatStock(totalUnits: number, p: Packaging): string;
export function packagingSummary(p: Packaging): string; // "1 pack = 10 strips = 100 tablets"
```

Add `usePackaging(medicineId)` hook + bulk variant for lists.

---

## Phase 3 — Add/Edit Medicine forms

Files: `AddMedicineDialog.tsx`, `EditMedicineDialog.tsx`, `CreateCustomItemDialog.tsx`, `EditBranchItemDialog.tsx`.

Replace existing packaging UI with the new 3-step section:
- Unit (always) — `unit_name`, `unit_selling_price`
- Strip toggle — `strip_name`, `units_per_strip`, `strip_selling_price` (auto-calc placeholder)
- Pack toggle (gated on strip) — `pack_name`, `strips_per_pack`, `pack_selling_price`
- Live summary line

Add **Medicine Code** searchable combobox with inline "+ Create new code" popover.

Save flow: upsert `medicine_packaging` for the medicine, convert any quantity entered at strip/pack level to units before writing `branch_items.quantity`.

---

## Phase 4 — POS / Sell screen

Files: `AddToCartDialog.tsx`, `CartSlider.tsx`, `SalesManagement.tsx`, `useSalesInventory.tsx`, sale-confirmation logic, `lib/batchInventory.ts`.

- Segmented control showing only enabled levels: [Unit] / [Unit|Strip] / [Unit|Strip|Pack]
- Quantity label updates with unit_name/strip_name/pack_name
- Price auto-fills from chosen level
- On confirm: `convertToUnits()` then deduct via existing FIFO

---

## Phase 5 — Display everywhere

Use `formatStock()` in:
- `StaffInventoryView`, `StaffInventoryWithActions`, `GlobalInventoryView`, `InventoryDashboard`
- `LowStockItemsTable`, `ExpiredMedicinesTable`, `ExpiringMedicinesAlert`
- `BatchBreakdownDialog`, `BatchAnalytics`, smart inventory tables
- Exports (`universal-export-styling`), Telegram reports

Update `useBranchInventory.tsx` to fetch `medicine_packaging` join instead of legacy columns.

---

## Phase 6 — Medicine Codes management

New file `src/components/inventory/MedicineCodes.tsx` + route under inventory tabs:
- Table: code, label, # linked medicines, total combined stock (formatted)
- Expand row → list linked medicines with per-item stock
- Create / edit / delete dialogs (delete sets `medicine_code_id` to null on linked medicines via FK)

Add hook `useMedicineCodes()`.

---

## Phase 7 — Cleanup

- Remove dead code referencing dropped columns (`itemTypes.ts`, `medicineDisplay.ts`, `OpenPackAdjustmentDialog`, etc.)
- Update TS types after regeneration
- Sanity sweep of grep for `units_per_pack|packaging_mode|sub_unit_*|item_type` to catch stragglers

---

## Risks / clarifications needed before I execute

1. **Existing data**: I cannot tell from here whether your current `branch_items.quantity` is stored in units or in strips for `with_strip` items. The original memory says strips are deducted FIFO via `inventory_batches`, but the unit basis for the running quantity is ambiguous. I need a one-time audit query before the backfill, otherwise stock counts will silently be wrong by a factor of `units_per_strip`.
2. **Dropping columns** is destructive and irreversible. I'll do it in a **second migration** after the new code ships and you confirm the UI works, rather than in the same migration.
3. **`item_type`** is used by smart-inventory + AI assistant for "countable vs measurable" logic (per memory). Removing it means measurable items (ml, g) lose their distinction. I'll fold this into `unit_name` (free text) — confirm that's acceptable, otherwise keep `item_type`.
4. **Sub-unit pricing**: legacy schema has `unit_price` + `sub_unit_price`. New schema has unit/strip/pack prices. The mapping will be: `unit_selling_price ← sub_unit_price`, `strip_selling_price ← unit_price`. Confirm.
5. **Branch-level pricing override**: `branch_items.selling_price` currently overrides medicine price. I'll keep that as the unit-level override and not touch it.
6. Estimated scope: ~25–30 file edits, 2 migrations, ~600 LOC new utilities + medicine codes UI. Plan to do it in sequenced commits matching the phases above.

If you approve, I'll start with the migrations + utility, then forms, then POS, then displays, then medicine codes.