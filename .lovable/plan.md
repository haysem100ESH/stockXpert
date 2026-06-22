## Why it's failing

The Activity Center hits `staff_goals` and `staff_goal_assignments` and gets **HTTP 500**. PostgREST only returns 500 when the RLS policy itself crashes during evaluation (not 401/403 = denial, not 400 = bad column).

Two things are broken in your DB:

1. **`activity_log` policies are corrupted.** You shared:
   ```
   activity_log_insert_self  → WITH CHECK ( 7 )
   activity_log_select_own_or_owner → USING ( 7 )
   ```
   `( 7 )` is not a valid boolean predicate. Whatever was originally there got replaced with a literal integer. Postgres will throw at evaluation time.

2. **`staff_goals` SELECT policy references tables/columns that may not resolve** at runtime:
   ```sql
   EXISTS (SELECT 1 FROM public.profiles p
           JOIN public.pharmacy_branches b ON b.id = p.branch_id
           WHERE ... AND b.pharmacy_owner_id = staff_goals.owner_id ...)
   ```
   If `pharmacy_branches.pharmacy_owner_id` doesn't exist (or `profiles` has no `branch_id`), the whole policy errors → 500 for every user, including owners — even though the simpler `owner_id = auth.uid()` branch would have matched.

`staff_goal_assignments` 500s for the same reason: its policies reference `staff_goals`, and the broken state propagates.

## The fix (one migration)

Drop and recreate the broken policies with safe, valid expressions. Move the owner-vs-staff resolution into a `SECURITY DEFINER` helper so the policies don't have to join tables inline (this is also what the project memory's "user-roles" pattern recommends, and it removes any chance of recursion / undefined-table crashes inside the policy).

### Step 1 — Helper function

```sql
CREATE OR REPLACE FUNCTION public.current_owner_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.resolve_owner_id(auth.uid())
$$;
GRANT EXECUTE ON FUNCTION public.current_owner_id() TO authenticated;
```

`resolve_owner_id` already exists in `activity-center-migration.sql` and safely returns the owner id whether the caller is an owner or a staff member. Wrapping it means policies never have to touch `profiles` / `pharmacy_branches` directly.

### Step 2 — Fix `activity_log`

```sql
DROP POLICY IF EXISTS activity_log_select_own_or_owner ON public.activity_log;
DROP POLICY IF EXISTS activity_log_insert_self        ON public.activity_log;

CREATE POLICY activity_log_select_own_or_owner ON public.activity_log
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR owner_id = auth.uid());

CREATE POLICY activity_log_insert_self ON public.activity_log
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
```

### Step 3 — Fix `staff_goals`

```sql
DROP POLICY IF EXISTS staff_goals_select_assigned ON public.staff_goals;
DROP POLICY IF EXISTS staff_goals_owner_all       ON public.staff_goals;

-- Owners: full control of their own goals.
CREATE POLICY staff_goals_owner_all ON public.staff_goals
  FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- Staff: read goals that belong to their owner, scoped by assignment_scope.
CREATE POLICY staff_goals_select_assigned ON public.staff_goals
  FOR SELECT TO authenticated
  USING (
    owner_id = public.current_owner_id()
    AND (
      assignment_scope = 'all'
      OR (assignment_scope = 'staff' AND EXISTS (
        SELECT 1 FROM public.staff_goal_assignments a
        WHERE a.goal_id = staff_goals.id AND a.staff_id = auth.uid()
      ))
      OR (assignment_scope = 'branch')  -- branch scoping resolved client-side; see note below
    )
  );
```

Note on `assignment_scope = 'branch'`: if `profiles.branch_id` does exist in this project, swap the last branch line for `(assignment_scope = 'branch' AND branch_id = (SELECT branch_id FROM public.profiles WHERE id = auth.uid()))`. We'll verify with a quick `\d profiles` check before committing the migration.

### Step 4 — Fix `staff_goal_assignments`

```sql
DROP POLICY IF EXISTS sga_owner_manage      ON public.staff_goal_assignments;
DROP POLICY IF EXISTS sga_staff_select_self ON public.staff_goal_assignments;

CREATE POLICY sga_owner_manage ON public.staff_goal_assignments
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.staff_goals g
    WHERE g.id = staff_goal_assignments.goal_id AND g.owner_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.staff_goals g
    WHERE g.id = staff_goal_assignments.goal_id AND g.owner_id = auth.uid()
  ));

CREATE POLICY sga_staff_select_self ON public.staff_goal_assignments
  FOR SELECT TO authenticated
  USING (staff_id = auth.uid());
```

### Step 5 — Verify

After running the migration:
- Reload the Activity Center as an owner → `staff_goals` and `staff_goal_assignments` should return 200.
- Reload as a staff user → only assigned/scoped goals come back.
- No 500s in the console.

## What I will NOT change

- No frontend changes — `useStaffGoals`, `Leaderboard`, `OwnerActivityCenterPage` stay as-is.
- No schema changes to columns or grants — only policy definitions.
- No edits to the unrelated medicine codes / batching work from earlier turns.
