/**
 * useBranchInventory
 * ----------------------------------------------------------------------------
 * TanStack Query–powered fetch + cache for the staff/owner inventory list.
 *
 * Performance:
 * - Primary query loads branch_items + medicines + branch names and renders
 *   the list immediately.
 * - Active ingredients (potentially many rows, only used for search/display
 *   in pharmacy mode) are fetched in a background query and merged in via
 *   useMemo so the list never blocks on them.
 *
 * Cache key: ['branch-inventory', { ownerId, selectedBranch, staffBranchId }]
 * Stale time: 60s.
 */
import { useEffect, useMemo } from 'react';
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

const CHUNK = 200;
const chunk = <T,>(arr: T[]): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += CHUNK) out.push(arr.slice(i, i + CHUNK));
  return out;
};

async function fetchBranchInventoryCore(branchIds: string[]): Promise<EnrichedBranchItem[]> {
  if (branchIds.length === 0) return [];

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

  const [medArrays, branchArrays] = await Promise.all([
    Promise.all(chunk(medicineIds).map((ids) =>
      supabase
        .from('medicines')
        .select('id, name, generic_name, category, manufacturer, batch_number, item_type, unit_label, units_per_pack, strips_per_pack, units_per_strip, medicine_group, strength, packaging_mode, sub_units_per_unit, main_unit_name, sub_unit_name, unit_price, sub_unit_price')
        .in('id', ids)
        .range(0, 9999)
        .then((r: any) => r.data || [])
    )),
    Promise.all(chunk(allBranchIds).map((ids) =>
      supabase
        .from('pharmacy_branches')
        .select('id, name')
        .in('id', ids)
        .then((r: any) => r.data || [])
    )),
  ]);

  const medMap: Record<string, any> = {};
  medArrays.flat().forEach((m: any) => { medMap[m.id] = m; });
  const branchMap: Record<string, string> = {};
  branchArrays.flat().forEach((b: any) => { branchMap[b.id] = b.name; });

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
      active_ingredients: [],
      branch_name: branchMap[item.branch_id],
    } as EnrichedBranchItem;
  });
}

async function fetchActiveIngredients(medicineIds: string[]) {
  if (medicineIds.length === 0) return {} as Record<string, Array<{ ingredient_name: string; strength: string | null }>>;
  const arrays = await Promise.all(chunk(medicineIds).map((ids) =>
    (supabase as any)
      .from('medicine_active_ingredients')
      .select('medicine_id, ingredient_name, strength, sort_order')
      .in('medicine_id', ids)
      .order('sort_order')
      .range(0, 49999)
      .then((r: any) => r.data || [])
  ));
  const ingMap: Record<string, Array<{ ingredient_name: string; strength: string | null }>> = {};
  arrays.flat().forEach((i: any) => {
    if (!ingMap[i.medicine_id]) ingMap[i.medicine_id] = [];
    ingMap[i.medicine_id].push({ ingredient_name: i.ingredient_name, strength: i.strength });
  });
  return ingMap;
}

export const BRANCH_INVENTORY_KEY = (scope: { ownerId?: string; selectedBranch?: string | null; staffBranchId?: string | null }) =>
  ['branch-inventory', scope] as const;

export function useBranchInventory() {
  const { profile } = useAuth();
  const { selectedBranch } = useBranchContext();
  const { branchIds: cachedOwnerBranchIds, isLoading: ownerBranchesLoading } = useOwnerBranchIds();
  const queryClient = useQueryClient();

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
    queryFn: () => fetchBranchInventoryCore(branchIds),
    enabled,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  // Background ingredients fetch — does not block list rendering.
  const medicineIds = useMemo(
    () => [...new Set((query.data ?? []).map((i) => (i as any).medicine_id))] as string[],
    [query.data]
  );

  const ingredientsQuery = useQuery({
    queryKey: ['branch-inventory-ingredients', medicineIds.length, medicineIds.slice(0, 5).join(',')],
    queryFn: () => fetchActiveIngredients(medicineIds),
    enabled: enabled && medicineIds.length > 0,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  const items = useMemo(() => {
    const base = query.data ?? [];
    const ingMap = ingredientsQuery.data;
    if (!ingMap) return base;
    return base.map((it) => ({
      ...it,
      active_ingredients: ingMap[(it as any).medicine_id] || [],
    }));
  }, [query.data, ingredientsQuery.data]);

  useEffect(() => {
    const handler = () => queryClient.invalidateQueries({ queryKey: ['branch-inventory'] });
    window.addEventListener('app:refresh', handler);
    return () => window.removeEventListener('app:refresh', handler);
  }, [queryClient]);

  return {
    items,
    loading: query.isLoading,
    isFetching: query.isFetching,
    refetch: query.refetch,
    removeItemFromCache: (id: string) => {
      queryClient.setQueryData<EnrichedBranchItem[]>(queryKey, (prev) =>
        (prev ?? []).filter((i) => i.id !== id)
      );
    },
    invalidate: () => queryClient.invalidateQueries({ queryKey: ['branch-inventory'] }),
  };
}
