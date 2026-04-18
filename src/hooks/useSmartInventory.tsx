import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/db';
import { useAuth } from '@/hooks/useAuth';
import { useBranchContext } from '@/hooks/useBranchContext';
import { useOwnerBranchIds } from '@/hooks/useOwnerBranchIds';
import { getSeasonalMultiplier } from '@/hooks/useSeasonalPerformance';

export interface InventoryItem {
  id: string;
  name: string;
  category: string;
  stock_quantity: number;
  minimum_stock_level: number;
  expiry_date: string | null;
  branch_id: string;
  selling_price: number;
  item_type?: string;
}

export interface SaleRecord {
  item_id: string;
  quantity: number;
  sale_date: string;
}

export interface SmartItem {
  id: string;
  name: string;
  category: string;
  currentStock: number;
  minStockLevel: number;
  expiryDate: string | null;
  sellingPrice: number;
  branchId: string;

  // Computed
  adc: number; // Average Daily Consumption
  predictedDemand14: number;
  safetyStock: number;
  suggestedReorder: number;
  needsReorder: boolean;
  daysRemaining: number | null; // null if no sales
  stockOutRisk: boolean;

  // Expiry (pharmacy only)
  daysUntilExpiry: number | null;
  expiryAlertLevel: 'none' | 'warning' | 'risk' | 'critical' | 'expired';

  // Dead stock
  isDeadStock: boolean;
  lastSaleDate: string | null;
  totalSold30Days: number;

  // Health score
  inventoryScore: number;
  scoreLevel: 'excellent' | 'good' | 'risk' | 'critical';
}

function calcExpiryLevel(daysUntilExpiry: number | null): SmartItem['expiryAlertLevel'] {
  if (daysUntilExpiry === null) return 'none';
  if (daysUntilExpiry <= 0) return 'expired';
  if (daysUntilExpiry < 30) return 'critical';
  if (daysUntilExpiry < 60) return 'risk';
  if (daysUntilExpiry < 90) return 'warning';
  return 'none';
}

function calcInventoryScore(item: {
  adc: number;
  currentStock: number;
  predictedDemand14: number;
  daysUntilExpiry: number | null;
  isDeadStock: boolean;
}): number {
  let score = 50; // base

  // Demand strength (+0 to +20)
  if (item.adc > 0) score += Math.min(20, item.adc * 5);

  // Stock balance (+0 to +30)
  if (item.predictedDemand14 > 0) {
    const ratio = item.currentStock / item.predictedDemand14;
    if (ratio >= 0.8 && ratio <= 2) score += 30;
    else if (ratio >= 0.5 && ratio <= 3) score += 20;
    else if (ratio > 0) score += 10;
  } else if (item.currentStock > 0) {
    score += 15; // has stock but no demand data
  }

  // Expiry risk (-0 to -30)
  if (item.daysUntilExpiry !== null) {
    if (item.daysUntilExpiry <= 0) score -= 30;
    else if (item.daysUntilExpiry < 30) score -= 25;
    else if (item.daysUntilExpiry < 60) score -= 15;
    else if (item.daysUntilExpiry < 90) score -= 5;
  }

  // Dead stock risk (-20)
  if (item.isDeadStock) score -= 20;

  return Math.max(0, Math.min(100, score));
}

function getScoreLevel(score: number): SmartItem['scoreLevel'] {
  if (score >= 80) return 'excellent';
  if (score >= 60) return 'good';
  if (score >= 40) return 'risk';
  return 'critical';
}

export function useSmartInventory() {
  const [items, setItems] = useState<SmartItem[]>([]);
  const [loading, setLoading] = useState(true);
  const { profile } = useAuth();
  const { selectedBranch, branchType } = useBranchContext();
  const { branchIds: cachedOwnerBranchIds } = useOwnerBranchIds();
  const isPharmacy = branchType === 'pharmacy';

  useEffect(() => {
    fetchData();
  }, [selectedBranch, profile, cachedOwnerBranchIds]);

  const fetchData = async () => {
    if (!profile) return;
    setLoading(true);

    try {
      // Get owner's branch IDs
      let branchIds: string[] = [];
      if (selectedBranch) {
        branchIds = [selectedBranch];
      } else if (profile.role === 'owner' && profile.id) {
        // Use cached owner-branch lookup.
        branchIds = cachedOwnerBranchIds;
      } else if (profile.branch_id) {
        branchIds = [profile.branch_id];
      }

      if (branchIds.length === 0) {
        setItems([]);
        setLoading(false);
        return;
      }

      // Fetch all branch_items for the branches, joined with medicines
      const { data: branchItemsData } = await supabase
        .from('branch_items')
        .select('id, medicine_id, branch_id, selling_price, purchase_price, quantity, expiry_date')
        .in('branch_id', branchIds);

      // Fetch medicine details for the branch_items
      const medIds = [...new Set((branchItemsData || []).map((bi: any) => bi.medicine_id))];
      const { data: medicines } = medIds.length > 0
        ? await supabase
            .from('medicines')
            .select('id, name, category, minimum_stock_level, item_type')
            .in('id', medIds)
        : { data: [] };

      const medMap: Record<string, any> = {};
      (medicines || []).forEach((m: any) => { medMap[m.id] = m; });

      // Map branch_items as inventory items for smart analysis
      const mappedMedicines = (branchItemsData || []).map((bi: any) => {
        const med = medMap[bi.medicine_id] || {};
        return {
          id: bi.id,
          name: med.name || 'Unknown',
          category: med.category || 'Uncategorized',
          stock_quantity: bi.quantity,
          minimum_stock_level: med.minimum_stock_level || 0,
          expiry_date: bi.expiry_date,
          branch_id: bi.branch_id,
          selling_price: bi.selling_price,
          item_type: med.item_type,
          medicine_id: bi.medicine_id,
        };
      });

      if (!mappedMedicines || mappedMedicines.length === 0) {
        setItems([]);
        setLoading(false);
        return;
      }

      const medicinesForAnalysis = mappedMedicines;

      // Fetch sales from last 60 days for dead stock + demand calc
      const sixtyDaysAgo = new Date();
      sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

      // Also fetch 12 months for seasonal multiplier
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

      const { data: recentSales } = await supabase
        .from('sale_items')
        .select('medicine_id, quantity, pack_quantity, strip_quantity, created_at, sales!inner(branch_id)')
        .in('sales.branch_id', branchIds)
        .gte('created_at', sixtyDaysAgo.toISOString());

      const { data: yearlySales } = await supabase
        .from('sale_items')
        .select('medicine_id, quantity, pack_quantity, strip_quantity, created_at, sales!inner(branch_id)')
        .in('sales.branch_id', branchIds)
        .gte('created_at', oneYearAgo.toISOString());

      // Build monthly map for seasonal multiplier: medicine_id -> month(0-11) -> qty
      const monthlyMap: Record<string, number[]> = {};
      (yearlySales || []).forEach((sale: any) => {
        const id = sale.medicine_id;
        if (!monthlyMap[id]) monthlyMap[id] = new Array(12).fill(0);
        const month = new Date(sale.created_at).getMonth();
        const packStripQty = (sale.pack_quantity || 0) + (sale.strip_quantity || 0);
        const qty = packStripQty > 0 ? packStripQty : (sale.quantity || 0);
        monthlyMap[id][month] += qty;
      });

      // Build sales map: medicine_id -> { totalQty30, totalQty60, lastSaleDate }
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const now = new Date();

      const salesMap: Record<string, { totalQty30: number; totalQty60: number; lastSaleDate: string | null }> = {};

      (recentSales || []).forEach((sale: any) => {
        const id = sale.medicine_id;
        if (!salesMap[id]) salesMap[id] = { totalQty30: 0, totalQty60: 0, lastSaleDate: null };

        const packStripQty = (sale.pack_quantity || 0) + (sale.strip_quantity || 0);
        const qty = packStripQty > 0 ? packStripQty : (sale.quantity || 0);
        const saleDate = new Date(sale.created_at);

        salesMap[id].totalQty60 += qty;
        if (saleDate >= thirtyDaysAgo) {
          salesMap[id].totalQty30 += qty;
        }

        if (!salesMap[id].lastSaleDate || sale.created_at > salesMap[id].lastSaleDate!) {
          salesMap[id].lastSaleDate = sale.created_at;
        }
      });

      // Compute smart items
      const smartItems: SmartItem[] = medicinesForAnalysis.map((med: any) => {
        // Use medicine_id for sales lookup (sale_items references the original medicine)
        const lookupId = med.medicine_id || med.id;
        const sales = salesMap[lookupId] || { totalQty30: 0, totalQty60: 0, lastSaleDate: null };
        const adc = sales.totalQty30 / 30;

        // Apply seasonal multiplier to demand prediction
        const seasonalMult = getSeasonalMultiplier(monthlyMap[lookupId] || new Array(12).fill(0));
        const predictedDemand14 = adc * 14 * seasonalMult;

        const safetyStock = predictedDemand14 * 0.2;
        const minLevel = med.minimum_stock_level || 0;
        // Reorder if either predicted 14-day demand exceeds stock, OR stock is below the
        // configured minimum (covers low-stock items that have not sold recently).
        const belowMin = minLevel > 0 && med.stock_quantity < minLevel;
        const needsReorder = med.stock_quantity < predictedDemand14 || belowMin;
        // Target restock = enough to cover demand+safety, but never less than the minimum.
        const target = Math.max(predictedDemand14 + safetyStock, minLevel);
        const suggestedReorder = needsReorder
          ? Math.max(1, Math.ceil(target - med.stock_quantity))
          : 0;

        const daysRemaining = adc > 0 ? Math.round(med.stock_quantity / adc) : null;
        const stockOutRisk = daysRemaining !== null && daysRemaining < 7;

        // Expiry
        let daysUntilExpiry: number | null = null;
        if (med.expiry_date) {
          const expiryDate = new Date(med.expiry_date);
          daysUntilExpiry = Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        }
        const expiryAlertLevel = calcExpiryLevel(daysUntilExpiry);

        // Dead stock: no sales in 60 days AND stock > 0
        const isDeadStock = sales.totalQty60 === 0 && med.stock_quantity > 0;

        const scoreInput = { adc, currentStock: med.stock_quantity, predictedDemand14, daysUntilExpiry, isDeadStock };
        const inventoryScore = calcInventoryScore(scoreInput);

        return {
          id: med.id,
          name: med.name,
          category: med.category || 'Uncategorized',
          currentStock: med.stock_quantity,
          minStockLevel: med.minimum_stock_level || 0,
          expiryDate: med.expiry_date,
          sellingPrice: med.selling_price || 0,
          branchId: med.branch_id,
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
          lastSaleDate: sales.lastSaleDate,
          totalSold30Days: sales.totalQty30,
          inventoryScore,
          scoreLevel: getScoreLevel(inventoryScore),
        };
      });

      setItems(smartItems);
    } catch (error) {
      console.error('Error fetching smart inventory data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Derived summaries
  const summary = useMemo(() => {
    // Only show items with actual recent sales in the demand list (adc > 0).
    const topDemand = [...items].filter(i => i.adc > 0).sort((a, b) => b.adc - a.adc).slice(0, 20);
    const reorderItems = items.filter(i => i.needsReorder);
    const stockOutAlerts = items.filter(i => i.stockOutRisk);
    const deadStock = items.filter(i => i.isDeadStock);
    const expiryAlerts = items.filter(i => i.expiryAlertLevel !== 'none');
    const criticalExpiry = items.filter(i => i.expiryAlertLevel === 'critical' || i.expiryAlertLevel === 'expired');

    const avgScore = items.length > 0
      ? Math.round(items.reduce((sum, i) => sum + i.inventoryScore, 0) / items.length)
      : 0;

    const scoreDist = {
      excellent: items.filter(i => i.scoreLevel === 'excellent').length,
      good: items.filter(i => i.scoreLevel === 'good').length,
      risk: items.filter(i => i.scoreLevel === 'risk').length,
      critical: items.filter(i => i.scoreLevel === 'critical').length,
    };

    return {
      topDemand,
      reorderItems,
      stockOutAlerts,
      deadStock,
      expiryAlerts,
      criticalExpiry,
      avgScore,
      scoreDist,
      totalItems: items.length,
    };
  }, [items]);

  return { items, summary, loading, isPharmacy, refetch: fetchData };
}
