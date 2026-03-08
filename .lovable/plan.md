

## Multi-Branch Warehouse + Stock Movement System — Implementation Plan

### Current Architecture

Your system already has `pharmacy_branches` (with types: pharmacy/general), `medicines` with `branch_id`, and a `medicine_transfers` table. Each branch maintains completely independent inventory — no shared catalog, no warehouse concept.

### What Changes

We'll evolve the branch system into a **Locations** hierarchy (warehouse → branches) with a shared stock movement pipeline, transfer requests, and a global inventory view.

---

### Database Changes (You'll Run These in SQL Editor)

**1. New `locations` table** — extends the concept beyond branches:

```sql
CREATE TABLE public.locations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  pharmacy_owner_id uuid NOT NULL,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('warehouse', 'pharmacy', 'store')),
  address text,
  phone text,
  branch_id uuid REFERENCES public.pharmacy_branches(id),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT locations_pkey PRIMARY KEY (id)
);
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
```

> Links to existing `pharmacy_branches` via optional `branch_id` so existing branch data is preserved.

**2. New `stock_movements` table:**

```sql
CREATE TABLE public.stock_movements (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  medicine_id uuid NOT NULL REFERENCES public.medicines(id),
  from_location_id uuid REFERENCES public.locations(id),
  to_location_id uuid REFERENCES public.locations(id),
  quantity numeric NOT NULL CHECK (quantity > 0),
  movement_type text NOT NULL CHECK (movement_type IN ('TRANSFER', 'SUPPLY', 'RETURN', 'ADJUSTMENT')),
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'in_transit', 'completed', 'cancelled')),
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT stock_movements_pkey PRIMARY KEY (id)
);
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
```

**3. New `transfer_requests` + `transfer_request_items` tables:**

```sql
CREATE TABLE public.transfer_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  requesting_location_id uuid NOT NULL REFERENCES public.locations(id),
  source_location_id uuid REFERENCES public.locations(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'fulfilled')),
  notes text,
  approved_by uuid REFERENCES auth.users(id),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT transfer_requests_pkey PRIMARY KEY (id)
);

CREATE TABLE public.transfer_request_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.transfer_requests(id) ON DELETE CASCADE,
  medicine_id uuid NOT NULL REFERENCES public.medicines(id),
  requested_quantity numeric NOT NULL CHECK (requested_quantity > 0),
  approved_quantity numeric DEFAULT 0,
  CONSTRAINT transfer_request_items_pkey PRIMARY KEY (id)
);

ALTER TABLE public.transfer_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transfer_request_items ENABLE ROW LEVEL SECURITY;
```

**4. Add `location_id` to medicines table:**

```sql
ALTER TABLE public.medicines ADD COLUMN location_id uuid REFERENCES public.locations(id);
```

> Existing `branch_id` remains for backward compatibility. New location-based queries use `location_id`.

---

### Frontend Implementation

**Phase 1 — Locations Management** (new page `/locations`)
- Create `src/components/locations/LocationManagement.tsx` — CRUD for locations (warehouse/pharmacy/store)
- Add to sidebar for owners
- Auto-create locations from existing branches on first load (migration helper)

**Phase 2 — Stock Movements** (new page `/stock-movements`)
- Create `src/components/stock/StockMovementForm.tsx` — form to move stock between locations
- Create `src/components/stock/StockMovementHistory.tsx` — filterable history table
- Replaces/enhances existing `MedicineTransfer.tsx`

**Phase 3 — Transfer Requests** (new page `/transfer-requests`)
- Create `src/components/stock/TransferRequestForm.tsx` — branch staff/manager can request items from warehouse
- Create `src/components/stock/TransferRequestList.tsx` — owner/warehouse manager sees pending requests, approves/rejects
- On approval → auto-creates stock movement entries and adjusts quantities

**Phase 4 — Global Inventory Dashboard**
- Create `src/components/inventory/GlobalInventoryView.tsx` — table showing `Medicine | Warehouse | Branch1 | Branch2 | Total`
- Add as a tab in the owner's inventory page
- Per-location low stock alerts with "suggest transfer from warehouse" action

**Phase 5 — Sidebar & Routing**
- Add routes: `/locations`, `/stock-movements`, `/transfer-requests`
- Add sidebar items for owners: Locations, Stock Movements, Transfer Requests
- Staff see Transfer Requests (to request stock)

**Phase 6 — Telegram Notifications**
- Extend existing Telegram functions to send alerts for:
  - Stock transfer completed
  - Low stock per branch (with warehouse suggestion)
  - Transfer request pending approval

---

### Backward Compatibility Strategy

- Existing `branch_id` on medicines stays intact — all current queries continue to work
- New `location_id` is populated alongside `branch_id`
- The existing `medicine_transfers` table is kept for history; new movements go into `stock_movements`
- A one-time data sync maps existing branches → locations

---

### Summary of New Files

| File | Purpose |
|------|---------|
| `src/pages/LocationsPage.tsx` | Route wrapper |
| `src/pages/StockMovementsPage.tsx` | Route wrapper |
| `src/pages/TransferRequestsPage.tsx` | Route wrapper |
| `src/components/locations/LocationManagement.tsx` | CRUD locations |
| `src/components/stock/StockMovementForm.tsx` | Create movements |
| `src/components/stock/StockMovementHistory.tsx` | Movement log |
| `src/components/stock/TransferRequestForm.tsx` | Request items |
| `src/components/stock/TransferRequestList.tsx` | Approve/reject |
| `src/components/inventory/GlobalInventoryView.tsx` | Cross-location view |

### Files Modified

- `src/App.tsx` — new routes
- `src/components/AppSidebar.tsx` — new nav items
- `src/components/inventory/InventoryManagement.tsx` — add Global Inventory tab
- `src/components/dashboard/OwnerDashboard.tsx` — low stock per-location alerts
- Telegram edge functions — new alert types

