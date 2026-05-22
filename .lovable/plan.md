## Issue 1 — AI chat panel overflows the top of the screen

**File:** `src/components/chat/SmartAssistant.tsx`

The floating button and the chat panel both use the same `positionStyle` (`bottom: ${bottomOffset}px`). The button is small (56px), so it's allowed to live anywhere from `bottom: 8` up to `bottom: viewportHeight - 64`. But the panel is 560px tall — when the user drags the button near the top, the panel anchored at that same large `bottom` value grows upward and pokes off the top of the screen (the `max-h-[calc(100vh-4rem)]` clamp limits height, not position).

**Fix:** compute a separate `panelBottom` for the panel that keeps it inside the viewport.

```ts
const PANEL_HEIGHT = 560;
const panelBottom = Math.max(
  16,
  Math.min(bottomOffset, window.innerHeight - PANEL_HEIGHT - 16)
);
```

Apply `panelBottom` only to the panel's inline style (keep button using `bottomOffset` so its drag position is preserved). Recompute on window resize so the clamp adapts to viewport changes.

---

## Issue 2 — "X / undefined staff used" in Staff Management header

**Files:** `src/components/staff/StaffManagement.tsx` (line 252) and `src/hooks/usePlanLimits.tsx`

The header uses `planLimits.staffLimit === null` to detect "unlimited". But in `usePlanLimits.tsx` we set `staffLimit: plan?.staff_limit` — if `plan` exists but `staff_limit` is missing, the value is `undefined`, not `null`, so the strict check fails and the fallback string renders `"X / undefined staff used on … plan"`.

**Fix (pick the cleaner one — normalize at the source):**

In `usePlanLimits.tsx`, coalesce undefined → null:
```ts
staffLimit: plan?.staff_limit ?? null,
branchesLimit: plan?.branches_limit ?? null,
```

Also harden the JSX check defensively:
```tsx
planLimits.staffLimit == null
  ? `Unlimited staff on ${planLimits.planName} plan`
  : `${planLimits.currentStaff} / ${planLimits.staffLimit} staff used on ${planLimits.planName} plan`
```

Scope: two small, isolated edits. No business logic changes.