## Problem

In `src/components/inventory/ImportCsvDialog.tsx`, even when a row clearly is an ingredient continuation (NAME OF ITEMS empty, GENERIC NAME filled), it still gets flagged as a missing-name / missing-price / duplicate item.

Root cause: the parser detects ingredient rows by reading `get(cells, 'generic_name')`, which depends on the header `GENERIC NAME` being recognized. In the user's sheet the GENERIC NAME column comes through, but two things can still break the branch:

1. The "blank row" early-skip on line 445 uses `cells.some(c => String(c).trim() !== '')`. That works, but the ingredient branch then only fires when both NAME is empty AND `generic_name_raw` is truthy. If GENERIC NAME got mapped to a different column index (e.g., header detection picked a row where GENERIC NAME wasn't yet present, or the column index for `name` is shifted), `name` may actually pick up the generic name's cell — making `name` non-empty for one row and `generic_name_raw` empty for the next, so the ingredient branch is skipped and the row is treated as a malformed standalone item.
2. Even when GENERIC NAME is present, any stray cell (CATEGORY = "Tab" copied down, leftover BATCH NO, an EX-DATE in another column) makes `hasItemData()` return true, which then bypasses the ingredient path and runs full standalone-item validation → "missing name", "missing price", "duplicate (empty name)".

## Fix

Make the rule literal and unconditional: **in pharmacy mode, a row with empty NAME OF ITEMS is never a standalone item.** It either becomes an ingredient of the medicine above, or it is silently skipped. No `hasItemData` escape hatch.

### Edits in `src/components/inventory/ImportCsvDialog.tsx`

1. **Replace the name-less-row block (~lines 454–476)** with this logic, evaluated *before* any standalone validation, duplicate check, or `hasItemData` test:

   ```ts
   if (isPharmacy && !name) {
     const parent = out[out.length - 1];

     if (generic_name_raw) {
       if (!parent) {
         errs.push(
           `Row ${r + 1}: ingredient "${generic_name_raw}" has no parent medicine above it. ` +
           `Add a NAME OF ITEMS on the row above, or remove this row.`
         );
         continue;
       }
       parent.active_ingredients.push({
         rowIndex: r + 1,
         ingredient_name: generic_name_raw,
         strength: normalizeStrength(strengthRaw),
       });
       continue;
     }

     // No NAME and no GENERIC NAME → treat as separator / leftover row.
     // Never flag missing-name, missing-price, or duplicate.
     continue;
   }
   ```

2. **Delete the `hasItemData` helper and its call.** With the new rule, name-less rows in pharmacy mode are exhaustively handled above, so no escape hatch is needed.

3. **Header-detection robustness**: when scoring header rows (current loop at ~lines 379–389), also require that the candidate row contains the canonical key `name`. This prevents picking a partial/secondary header row in which `name` is missing and a downstream column gets mis-mapped to `name`. Concretely: in the recognized-count loop, prefer the row with the highest recognized count *that also contains* `name`; only fall back to the highest-overall if none do.

4. **Diagnostic improvement (small)**: when an ingredient row is attached, also persist its raw row number so the preview UI can show it under its parent (already supported via `rowIndex`). No UI changes needed.

5. **General-mode behavior unchanged.** For `isPharmacy === false`, name-less rows still raise the existing "NAME OF ITEMS is empty" error.

### Out of scope

- No DB / schema changes.
- No changes to the per-row progress UI, branch scoping, batch creation, or duplicate detection for *named* items.
- No changes to general-inventory import.

## Acceptance check

After the fix, importing the user's sheet:

- Rows like `pseudoephedrine hydrochloride 15mg` and `Chlorpheneramine maleate 1mg` (no NAME, GENERIC NAME present) attach as active ingredients of the medicine on the row above ("Snip").
- Rows 13 / 14 / 16 (empty NAME, empty GENERIC NAME, possibly stray cells) are silently skipped — no "missing name", no "missing price", no "duplicate (empty name)" errors.
- Standalone medicines (NAME present) still go through full validation and duplicate detection unchanged.
