/**
 * useBranchInventory
 * ----------------------------------------------------------------------------
 * TanStack Query–powered fetch + cache for the staff/owner inventory list
 * (`branch_items` joined with `medicines` + branch names).
 *
 * Why:
 * - Previously the list re-fetched on every mount (3 sequential queries) which
 *   made navigating away and back feel sluggish.
 * - With React Query the second visit hydrates instantly from cache while the
 *   list quietly revalidates in the background.
 *
 * Cache key: ['branch-inventory', { ownerId, selectedBranch, staffBranchId }]
 * Stale time: 60s. Pull-to-refresh invalidates everything globally, so any
 * external mutation can simply invalidate this key.
 */
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/db';
import { useAuth } from './useAuth';
import { useBranchContext } from './useBranchContext';
import { useOwnerBranchIds } from './useOwnerBranchIds';
import type { BranchItem } from '@/components/inventory/EditBranchItemDialog';

export type EnrichedBranchItem = BranchItem & {
  branch_name?: string;
  medicine_group?: string | null;
  strength?: string | null;
  active_ingredients?: Array<{ ingredient_name: string; strength: string | null }>;
  packaging_mode?: string | null;
  sub_units_per_unit?: number | null;
  main_unit_name?: string | null;
  sub_unit_name?: string | null;
  unit_price?: number | null;
  sub_unit_price?: number | null;
};

interface FetchArgs {
  branchIds: string[];
}

async function fetchBranchInventory({ branchIds }: FetchArgs): Promise<EnrichedBranchItem[]> {
  if (branchIds.length === 0) return [];

  // 1. Fetch branch_items (explicit range to bypass Supabase's default 1000-row cap).
  const { data: items, error } = await supabase
    .from('branch_items')
    .select('id, medicine_id, branch_id, owner_id, selling_price, purchase_price, quantity, expiry_date')
    .in('branch_id', branchIds)
    .order('created_at', { ascending: false })
    .range(0, 49999);

  if (error) throw error;
  if (!items || items.length === 0) return [];

  const medicineIds = [...new Set(items.map((i: any) => i.medicine_id))];
  const allBranchIds = [...new Set(items.map((i: any) => i.branch_id))];

  // Helper: chunk .in() lookups so URLs stay short and we never hit row caps.
  const CHUNK = 200;
  const chunk = <T,>(arr: T[]): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += CHUNK) out.push(arr.slice(i, i + CHUNK));
    return out;
  };

  const medChunks = chunk(medicineIds);
  const branchChunks = chunk(allBranchIds);

  const [medArrays, branchArrays, ingArrays] = await Promise.all([
    Promise.all(medChunks.map((ids) =>
      supabase
        .from('medicines')
        .select('id, name, generic_name, category, manufacturer, batch_number, item_type, unit_label, units_per_pack, strips_per_pack, units_per_strip, medicine_group, strength, packaging_mode, sub_units_per_unit, main_unit_name, sub_unit_name, unit_price, sub_unit_price')
        .in('id', ids)
        .range(0, 9999)
        .then((r: any) => r.data || [])
    )),
    Promise.all(branchChunks.map((ids) =>
      supabase
        .from('pharmacy_branches')
        .select('id, name')
        .in('id', ids)
        .then((r: any) => r.data || [])
    )),
    Promise.all(medChunks.map((ids) =>
      (supabase as any)
        .from('medicine_active_ingredients')
        .select('medicine_id, ingredient_name, strength, sort_order')
        .in('medicine_id', ids)
        .order('sort_order')
        .range(0, 49999)
        .then((r: any) => r.data || [])
    )),
  ]);

  const medsRes = { data: medArrays.flat() };
  const branchesRes = { data: branchArrays.flat() };
  const ingredientsRes = { data: ingArrays.flat() };

  const medMap: Record<string, any> = {};
  (medsRes.data || []).forEach((m: any) => { medMap[m.id] = m; });
  const branchMap: Record<string, string> = {};
  (branchesRes.data || []).forEach((b: any) => { branchMap[b.id] = b.name; });
  const ingMap: Record<string, Array<{ ingredient_name: string; strength: string | null }>> = {};
  ((ingredientsRes as any).data || []).forEach((i: any) => {
    if (!ingMap[i.medicine_id]) ingMap[i.medicine_id] = [];
    ingMap[i.medicine_id].push({ ingredient_name: i.ingredient_name, strength: i.strength });
  });

  return items.map((item: any) => {
    const med = medMap[item.medicine_id] || {};
    return {
      ...item,
      name: med.name || 'Unknown',
      generic_name: med.generic_name,
      category: med.category || 'Uncategorized',
      manufacturer: med.manufacturer,
      batch_number: med.batch_number,
      item_type: med.item_type,
      unit_label: med.unit_label,
      units_per_pack: med.units_per_pack,
      strips_per_pack: med.strips_per_pack,
      units_per_strip: med.units_per_strip,
      medicine_group: med.medicine_group,
      strength: med.strength,
      packaging_mode: med.packaging_mode,
      sub_units_per_unit: med.sub_units_per_unit,
      main_unit_name: med.main_unit_name,
      sub_unit_name: med.sub_unit_name,
      unit_price: med.unit_price,
      sub_unit_price: med.sub_unit_price,
      active_ingredients: ingMap[item.medicine_id] || [],
      branch_name: branchMap[item.branch_id],
    } as EnrichedBranchItem;
  });
}

export const BRANCH_INVENTORY_KEY = (scope: { ownerId?: string; selectedBranch?: string | null; staffBranchId?: string | null }) =>
  ['branch-inventory', scope] as const;

export function useBranchInventory() {
  const { profile } = useAuth();
  const { selectedBranch } = useBranchContext();
  const { branchIds: cachedOwnerBranchIds, isLoading: ownerBranchesLoading } = useOwnerBranchIds();
  const queryClient = useQueryClient();

  // Resolve the branch scope.
  let branchIds: string[] = [];
  if (selectedBranch) {
    branchIds = [selectedBranch];
  } else if (profile?.role === 'owner') {
    branchIds = cachedOwnerBranchIds;
  } else if (profile?.branch_id) {
    branchIds = [profile.branch_id];
  }

  const enabled = !!profile && (profile.role !== 'owner' || !ownerBranchesLoading);

  const queryKey = BRANCH_INVENTORY_KEY({
    ownerId: profile?.role === 'owner' ? profile.id : undefined,
    selectedBranch,
    staffBranchId: profile?.role !== 'owner' ? profile?.branch_id : undefined,
  });

  const query = useQuery({
    queryKey,
    queryFn: () => fetchBranchInventory({ branchIds }),
    enabled,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev, // keep previous data on key change → instant hydration
  });

  // Listen to legacy 'app:refresh' (pull-to-refresh) events for parity.
  useEffect(() => {
    const handler = () => queryClient.invalidateQueries({ queryKey: ['branch-inventory'] });
    window.addEventListener('app:refresh', handler);
    return () => window.removeEventListener('app:refresh', handler);
  }, [queryClient]);

  return {
    items: query.data ?? [],
    loading: query.isLoading,
    isFetching: query.isFetching,
    refetch: query.refetch,
    /** Imperatively remove a row from the cache (used after delete). */
    removeItemFromCache: (id: string) => {
      queryClient.setQueryData<EnrichedBranchItem[]>(queryKey, (prev) =>
        (prev ?? []).filter((i) => i.id !== id)
      );
    },
    invalidate: () => queryClient.invalidateQueries({ queryKey: ['branch-inventory'] }),
  };
}
