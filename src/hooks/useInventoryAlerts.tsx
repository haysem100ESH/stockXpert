import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/db';
import { useAuth } from '@/hooks/useAuth';
import { useBranchContext } from '@/hooks/useBranchContext';
import { useExpiryThreshold } from '@/hooks/useExpiryThreshold';
import { useLowStockThreshold } from '@/hooks/useLowStockThreshold';

export interface InventoryAlertCounts {
  expired: number;
  expiringSoon: number;
  outOfStock: number;
  lowStock: number;
  total: number;
}

const EMPTY: InventoryAlertCounts = {
  expired: 0,
  expiringSoon: 0,
  outOfStock: 0,
  lowStock: 0,
  total: 0,
};

export function useInventoryAlerts() {
  const { profile } = useAuth();
  const { userBranch, selectedBranch } = useBranchContext();
  const { days: thresholdDays } = useExpiryThreshold();
  const { threshold: lowStockThreshold } = useLowStockThreshold();
  const [counts, setCounts] = useState<InventoryAlertCounts>(EMPTY);

  const getEffectiveBranchId = useCallback(() => {
    if (profile?.role === 'staff') return userBranch || profile?.branch_id;
    return selectedBranch;
  }, [profile, userBranch, selectedBranch]);

  const fetchAlerts = useCallback(async () => {
    try {
      const effectiveBranchId = getEffectiveBranchId();
      const today = new Date().toISOString().split('T')[0];
      const thresholdDate = new Date();
      thresholdDate.setDate(thresholdDate.getDate() + thresholdDays);
      const thresholdStr = thresholdDate.toISOString().split('T')[0];

      let ownerBranchIds: string[] = [];
      if (!effectiveBranchId && profile?.role === 'owner' && profile?.id) {
        const { data: ownerBranches } = await supabase
          .from('pharmacy_branches')
          .select('id')
          .eq('pharmacy_owner_id', profile.id);
        ownerBranchIds = (ownerBranches || []).map((b: any) => b.id);
        if (ownerBranchIds.length === 0) { setCounts(EMPTY); return; }
      }

      const addBranchFilter = (q: any) => {
        if (profile?.role === 'staff') {
          const sid = userBranch || profile?.branch_id;
          if (!sid) return null;
          return q.eq('branch_id', sid);
        }
        if (effectiveBranchId) return q.eq('branch_id', effectiveBranchId);
        if (profile?.role === 'owner' && ownerBranchIds.length > 0) return q.in('branch_id', ownerBranchIds);
        return null;
      };

      let itemsQuery: any = supabase
        .from('branch_items')
        .select('id, medicine_id, quantity, medicines!inner(minimum_stock_level)');
      itemsQuery = addBranchFilter(itemsQuery);
      if (!itemsQuery) { setCounts(EMPTY); return; }
      const { data: items } = await itemsQuery;

      let batchQuery: any = supabase
        .from('inventory_batches')
        .select('id, medicine_id, branch_id, remaining_quantity, expiry_date');
      batchQuery = addBranchFilter(batchQuery);
      const { data: batches } = batchQuery ? await batchQuery : { data: [] };

      let oos = 0, low = 0;
      for (const item of (items || []) as any[]) {
        const qty = Number(item.quantity) || 0;
        const itemMin = Number(item.medicines?.minimum_stock_level) || 0;
        const effectiveMin = itemMin > 0 ? itemMin : lowStockThreshold;
        if (qty === 0) oos++;
        else if (effectiveMin > 0 && qty <= effectiveMin) low++;
      }

      const expiredParents = new Set<string>();
      const expiringParents = new Set<string>();
      for (const b of (batches || []) as any[]) {
        if (!b.expiry_date || Number(b.remaining_quantity) <= 0) continue;
        if (b.expiry_date <= today) expiredParents.add(b.medicine_id);
        else if (b.expiry_date <= thresholdStr) expiringParents.add(b.medicine_id);
      }

      const expired = expiredParents.size;
      const expiringSoon = expiringParents.size;
      setCounts({
        expired,
        expiringSoon,
        outOfStock: oos,
        lowStock: low,
        total: expired + expiringSoon + oos + low,
      });
    } catch (e) {
      console.error('Error fetching inventory alerts:', e);
    }
  }, [profile, userBranch, selectedBranch, thresholdDays, lowStockThreshold, getEffectiveBranchId]);

  useEffect(() => { fetchAlerts(); }, [fetchAlerts]);

  useEffect(() => {
    const handler = () => fetchAlerts();
    window.addEventListener('app:refresh', handler);
    return () => window.removeEventListener('app:refresh', handler);
  }, [fetchAlerts]);

  return { counts, refetch: fetchAlerts };
}
