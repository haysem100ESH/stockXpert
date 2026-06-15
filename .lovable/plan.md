# Activity Center & Staff Goal Management

A large, multi-layer feature. Below is the build plan, broken into phases so we can ship incrementally and verify each layer.

## 1. Database (migration)

### `activity_log`
```
id uuid pk
user_id uuid -> auth.users
branch_id uuid -> pharmacy_branches
owner_id uuid (denormalized for fast owner queries)
activity_type text     -- 'create_item','edit_item','delete_item','sell_item',
                       --  'create_medicine_code','edit_medicine_code','delete_medicine_code',
                       --  'assign_item_to_code','unassign_item_from_code',
                       --  'create_category','edit_category','delete_category',
                       --  'request_stock_transfer','create_customer','edit_customer', ...
entity_type text       -- 'branch_item','medicine','medicine_code','category','sale','customer','transfer_request'
entity_id text
previous_value jsonb
new_value jsonb
metadata jsonb         -- per-type extras (item_name, qty, price, total, payment_method, field_changed...)
created_at timestamptz default now()
```
Indexes: `(owner_id, created_at desc)`, `(user_id, created_at desc)`, `(branch_id, created_at desc)`, `(activity_type)`.
RLS: staff sees own rows; owner sees rows where `owner_id = auth.uid()`; service_role full.
Grants per project rules.

### `staff_goals`
```
id uuid pk
owner_id uuid
name text
goal_type text   -- 'daily' | 'weekly' | 'monthly' | 'custom'
target_count int
start_date date  -- for custom; for daily/weekly/monthly = effective from
end_date date    -- nullable for recurring
assignment_scope text  -- 'all' | 'branch' | 'staff'
branch_id uuid nullable
created_at timestamptz default now()
active boolean default true
```

### `staff_goal_assignments`
```
id uuid pk
goal_id uuid -> staff_goals on delete cascade
staff_id uuid -> auth.users
```

### `staff_goal_completions`
```
id uuid pk
goal_id uuid
staff_id uuid
period_key text   -- e.g. '2026-06-15' / '2026-W24' / '2026-06' / 'custom-<goal_id>'
completed_at timestamptz default now()
unique(goal_id, staff_id, period_key)
```
Used to dedupe celebrations & owner notifications.

All four tables: GRANTs + RLS as per project conventions. Realtime enabled on `activity_log` and `staff_goal_completions`.

### Helper RPC
`log_activity(p_activity_type, p_entity_type, p_entity_id, p_previous jsonb, p_new jsonb, p_metadata jsonb)` — SECURITY DEFINER, resolves `owner_id` and `branch_id` from caller's `profiles` row, inserts into `activity_log`. Single entry point keeps client code small.

`get_activity_counts(p_user_id uuid, p_from timestamptz, p_to timestamptz)` — returns int. Used for goal progress.

## 2. Client logging layer

`src/lib/activityLog.ts`
```ts
export async function logActivity(input: {...}) {
  await supabase.rpc('log_activity', { ... });
}
```
Instrument existing mutation sites (one line each) in:
- AddBranchItemDialog / EditBranchItemDialog / delete flow
- MedicineCodes create/edit/delete + assign/unassign
- CategoryManagement create/edit/delete
- SalesManagement checkout (one row per sale, metadata holds items)
- TransferRequestForm
- AddCustomerDialog / EditCustomerDialog

Failures are swallowed (logging must never break user actions).

## 3. Hooks

- `useActivityFeed({ userId?, branchId?, date?, range? })` — fetches + subscribes to `activity_log` realtime channel filtered by owner/user.
- `useActivityCounts(userId)` — today / week / month counts, realtime updated by incrementing on new inserts.
- `useStaffGoals()` — owner: list/create/edit/delete; staff: active goals assigned to me.
- `useGoalProgress(goal)` — derives current period window, subscribes to activity counts, fires `onComplete` once when threshold crossed, writes `staff_goal_completions` row (dedupe via unique key).

## 4. Staff Portal — Activity Center

Route: `/activity` (staff). Sidebar entry under Staff section.

Layout:
- **Top cards**: Today / This Week / This Month counts (live).
- **Goal Progress cards** for each active goal assigned to me. Animated progress bar (tailwind transition on width). Shows target / completed / % / bonus (when over 100%).
- **Calendar filter** (shadcn Calendar in popover) → activity list for that date.
- **Activity list**: grouped by hour, each row expandable (Collapsible). Renderer picks a sub-component per `activity_type`:
  - SaleActivityRow: item(s), qty, unit price, total, payment method, time.
  - ItemEditRow: field changed, prev → new (diffed from `previous_value`/`new_value`).
  - MedicineCodeRow, CategoryRow, CustomerRow, TransferRow.

### Goal completion celebration
On `useGoalProgress` `onComplete`:
- Insert completion row (idempotent).
- Show `GoalCompletionModal`: confetti (lightweight `canvas-confetti`), achievement badge, message.
- Toast as fallback.

## 5. Owner Portal — Activity Center

Route: `/owner/activity`. Sidebar entry for owners only.

- **Branch selector** (reuse existing).
- **Leaderboards**: Today / Week / Month — top staff by activity count, with avatar, branch, count, rank.
- **Staff list** with counts. Click → drawer/dialog with that staff's full activity feed (reuse staff feed component scoped by `userId`).
- **Goal Management panel**:
  - Create / edit / delete goals.
  - Fields: name, type (daily/weekly/monthly/custom), target, dates (custom only), assignment (all / branch / specific staff multi-select).
  - Active goals table with progress per assignee.
- **Goal completion notifications**: subscribe to `staff_goal_completions` insert events where `owner_id = me` via a join view; show toast `"<staff> completed <goal> at <time>"` and a Bell dropdown list (persist last 50 in component state).

## 6. Bonus dashboard

Inside each goal card (owner & staff views): target, actual, extra, bonus %. Owner table aggregates per staff for the period.

## 7. Realtime

Use Supabase Realtime channels:
- `activity_log` insert filtered by `owner_id` (owner) or `user_id` (staff).
- `staff_goal_completions` filtered by owner.

All counters and progress bars react to channel events; no page refresh required.

## 8. Technical notes / files

New:
- `migrations/activity-center.sql`
- `src/lib/activityLog.ts`
- `src/hooks/useActivityFeed.tsx`, `useActivityCounts.tsx`, `useStaffGoals.tsx`, `useGoalProgress.tsx`
- `src/pages/ActivityCenterPage.tsx`, `src/pages/OwnerActivityCenterPage.tsx`
- `src/components/activity/ActivityList.tsx`, `ActivityRow.tsx`, `GoalProgressCard.tsx`, `GoalCompletionModal.tsx`, `GoalManager.tsx`, `Leaderboard.tsx`, `StaffActivityDrawer.tsx`
- `bun add canvas-confetti`

Edited (one-line `logActivity(...)` calls):
- inventory dialogs, MedicineCodes, CategoryManagement, SalesManagement, TransferRequestForm, customer dialogs

Routing: add routes in `src/App.tsx`, sidebar entries in `AppSidebar.tsx` (guarded by role).

## 9. Phased rollout (suggested commit order)

1. Migration + `logActivity` helper + instrumentation across existing mutation sites.
2. Staff Activity Center page (cards, calendar, expandable list, realtime).
3. Goals tables + owner Goal Manager UI.
4. Goal progress card on staff page + completion modal + confetti.
5. Owner Activity Center page (leaderboard, staff drill-down, completion notifications).
6. Bonus dashboard polish.

## Open question

Do you want the **owner notification** to be:
- (a) Toast + in-app bell dropdown only (lightweight, no extra cost), or
- (b) Also send a Telegram message via the existing bot integration?

Default if you don't specify: **(a)**.

Reply "go" to start with Phase 1 (DB + logging), or tell me which phase to start with / adjust.
