/**
 * useSmartInventory
 * ----------------------------------------------------------------------------
 * v2 — server-side aggregation via the `smart_inventory_summary` RPC.
 *
 * Before: 3 round-trips fetching ALL branch_items + 60d sale_items + 365d
 *         sale_items → potentially millions of rows aggregated client-side.
 * Now:    1 RPC returns ONE pre-aggregated row per branch_item. TanStack Query
 *         caches per-branch with staleTime so revisits are instant.
 *
 * Cache key: ['smart-inventory', sortedBranchIds.join(',')]
 */
import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/db';
import { useAuth } from '@/hooks/useAuth';
import { useBranchContext } from '@/hooks/useBranchContext';
import { useOwnerBranchIds } from '@/hooks/useOwnerBranchIds';
import { getSeasonalMultiplier } from '@/hooks/useSeasonalPerformance';

export interface SmartItem {
  id: string;
  name: string;
  category: string;
  currentStock: number;
  minStockLevel: number;
  expiryDate: string | null;
  sellingPrice: number;
  branchId: string;
  adc: number;
  predictedDemand14: number;
  safetyStock: number;
  suggestedReorder: number;
  needsReorder: boolean;
  daysRemaining: number | null;
  stockOutRisk: boolean;
  daysUntilExpiry: number | null;
  expiryAlertLevel: 'none' | 'warning' | 'risk' | 'critical' | 'expired';
  isDeadStock: boolean;
  lastSaleDate: string | null;
  totalSold30Days: number;
  inventoryScore: number;
  scoreLevel: 'excellent' | 'good' | 'risk' | 'critical';
}

interface RpcRow {
  branch_item_id: string;
  medicine_id: string;
  name: string;
  category: string;
  branch_id: string;
  stock_quantity: number;
  minimum_stock_level: number;
  expiry_date: string | null;
  selling_price: number;
  item_type: string | null;
  qty_30: number;
  qty_60: number;
  last_sale_date: string | null;
  monthly_qty: number[];
}

function calcExpiryLevel(d: number | null): SmartItem['expiryAlertLevel'] {
  if (d === null) return 'none';
  if (d <= 0) return 'expired';
  if (d < 30) return 'critical';
  if (d < 60) return 'risk';
  if (d < 90) return 'warning';
  return 'none';
}

function calcInventoryScore(it: { adc: number; currentStock: number; predictedDemand14: number; daysUntilExpiry: number | null; isDeadStock: boolean }): number {
  let s = 50;
  if (it.adc > 0) s += Math.min(20, it.adc * 5);
  if (it.predictedDemand14 > 0) {
    const r = it.currentStock / it.predictedDemand14;
    if (r >= 0.8 && r <= 2) s += 30;
    else if (r >= 0.5 && r <= 3) s += 20;
    else if (r > 0) s += 10;
  } else if (it.currentStock > 0) s += 15;
  if (it.daysUntilExpiry !== null) {
    if (it.daysUntilExpiry <= 0) s -= 30;
    else if (it.daysUntilExpiry < 30) s -= 25;
    else if (it.daysUntilExpiry < 60) s -= 15;
    else if (it.daysUntilExpiry < 90) s -= 5;
  }
  if (it.isDeadStock) s -= 20;
  return Math.max(0, Math.min(100, s));
}

function getScoreLevel(score: number): SmartItem['scoreLevel'] {
  if (score >= 80) return 'excellent';
  if (score >= 60) return 'good';
  if (score >= 40) return 'risk';
  return 'critical';
}

async function fetchSmartInventory(branchIds: string[]): Promise<SmartItem[]> {
  if (branchIds.length === 0) return [];

  const { data, error } = await (supabase as any).rpc('smart_inventory_summary', {
    _branch_ids: branchIds,
  });
  if (error) throw error;

  const now = Date.now();
  const rows: RpcRow[] = data || [];

  return rows.map((r) => {
    const adc = (Number(r.qty_30) || 0) / 30;
    const seasonalMult = getSeasonalMultiplier(r.monthly_qty || new Array(12).fill(0));
    const predictedDemand14 = adc * 14 * seasonalMult;
    const safetyStock = predictedDemand14 * 0.2;
    const minLevel = Number(r.minimum_stock_level) || 0;
    const stock = Number(r.stock_quantity) || 0;
    const belowMin = minLevel > 0 && stock < minLevel;
    const needsReorder = stock < predictedDemand14 || belowMin;
    const target = Math.max(predictedDemand14 + safetyStock, minLevel);
    const suggestedReorder = needsReorder ? Math.max(1, Math.ceil(target - stock)) : 0;
    const daysRemaining = adc > 0 ? Math.round(stock / adc) : null;
    const stockOutRisk = daysRemaining !== null && daysRemaining < 7;

    let daysUntilExpiry: number | null = null;
    if (r.expiry_date) {
      daysUntilExpiry = Math.ceil((new Date(r.expiry_date).getTime() - now) / 86_400_000);
    }
    const expiryAlertLevel = calcExpiryLevel(daysUntilExpiry);
    const isDeadStock = (Number(r.qty_60) || 0) === 0 && stock > 0;
    const inventoryScore = calcInventoryScore({ adc, currentStock: stock, predictedDemand14, daysUntilExpiry, isDeadStock });

    return {
      id: r.branch_item_id,
      name: r.name || 'Unknown',
      category: r.category || 'Uncategorized',
      currentStock: stock,
      minStockLevel: minLevel,
      expiryDate: r.expiry_date,
      sellingPrice: Number(r.selling_price) || 0,
      branchId: r.branch_id,
      adc,
      predictedDemand14,
      safetyStock,
      suggestedReorder,
      needsReorder,
      daysRemaining,
      stockOutRisk,
      daysUntilExpiry,
      expiryAlertLevel,
      isDeadStock,
      lastSaleDate: r.last_sale_date,
      totalSold30Days: Number(r.qty_30) || 0,
      inventoryScore,
      scoreLevel: getScoreLevel(inventoryScore),
    };
  });
}

export function useSmartInventory() {
  const { profile } = useAuth();
  const { selectedBranch, branchType } = useBranchContext();
  const { branchIds: cachedOwnerBranchIds, isLoading: ownerBranchesLoading } = useOwnerBranchIds();
  const isPharmacy = branchType === 'pharmacy';
  const queryClient = useQueryClient();

  const branchIds = useMemo(() => {
    if (selectedBranch) return [selectedBranch];
    if (profile?.role === 'owner') return cachedOwnerBranchIds;
    if (profile?.branch_id) return [profile.branch_id];
    return [];
  }, [selectedBranch, profile?.role, profile?.branch_id, cachedOwnerBranchIds]);

  const enabled = !!profile && (profile.role !== 'owner' || !ownerBranchesLoading) && branchIds.length > 0;

  const queryKey = useMemo(
    () => ['smart-inventory', [...branchIds].sort().join(',')] as const,
    [branchIds]
  );

  const query = useQuery({
    queryKey,
    queryFn: () => fetchSmartInventory(branchIds),
    enabled,
    staleTime: 2 * 60 * 1000,   // 2 min — heavy aggregation, OK to cache
    gcTime: 10 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  // Pull-to-refresh hook integration
  useEffect(() => {
    const handler = () => queryClient.invalidateQueries({ queryKey: ['smart-inventory'] });
    window.addEventListener('app:refresh', handler);
    return () => window.removeEventListener('app:refresh', handler);
  }, [queryClient]);

  const items = query.data ?? [];

  const summary = useMemo(() => {
    const topDemand = [...items].filter(i => i.adc > 0).sort((a, b) => b.adc - a.adc).slice(0, 20);
    const reorderItems = items.filter(i => i.needsReorder);
    const stockOutAlerts = items.filter(i => i.stockOutRisk);
    const deadStock = items.filter(i => i.isDeadStock);
    const expiryAlerts = items.filter(i => i.expiryAlertLevel !== 'none');
    const criticalExpiry = items.filter(i => i.expiryAlertLevel === 'critical' || i.expiryAlertLevel === 'expired');
    const avgScore = items.length > 0
      ? Math.round(items.reduce((s, i) => s + i.inventoryScore, 0) / items.length)
      : 0;
    const scoreDist = {
      excellent: items.filter(i => i.scoreLevel === 'excellent').length,
      good: items.filter(i => i.scoreLevel === 'good').length,
      risk: items.filter(i => i.scoreLevel === 'risk').length,
      critical: items.filter(i => i.scoreLevel === 'critical').length,
    };
    return { topDemand, reorderItems, stockOutAlerts, deadStock, expiryAlerts, criticalExpiry, avgScore, scoreDist, totalItems: items.length };
  }, [items]);

  return {
    items,
    summary,
    loading: query.isLoading,
    isPharmacy,
    refetch: query.refetch,
  };
}
