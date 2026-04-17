/**
 * useDashboardStats
 * ----------------------------------------------------------------------------
 * TanStack Query–powered cache for the Owner Dashboard "Overview" data.
 *
 * Why:
 * - Previously the overview re-ran 5+ Supabase queries on every mount and on
 *   every branch / date-filter change. Returning to the dashboard always
 *   showed a spinner.
 * - Now the data is cached per (ownerId, selectedBranch, dateFilter). On
 *   revisit the cached data renders instantly while the latest data
 *   revalidates silently in the background.
 *
 * Cache key: ['dashboard-stats', { ownerId, selectedBranch, dateFilter }]
 * Stale time: 60s. Pull-to-refresh and explicit invalidations bust it.
 */
import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/db';
import { useAuth } from './useAuth';
import { useBranchContext } from './useBranchContext';
import { useOwnerBranchIds } from './useOwnerBranchIds';

export type DateFilter = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface DashboardStats {
  totalRevenue: number;
  totalProducts: number;
  totalMedicines: number;
  totalItems: number;
  totalSoldItems: number;
  lowStockItems: number;
  outOfStockItems: number;
  expiredItems: number;
}

export interface CategorySalesData { category: string; sales: number; revenue: number; }
export interface ProductPerformanceData { name: string; sales: number; revenue: number; }
export interface PaymentMethodData { method: string; amount: number; }

export interface DashboardOverview {
  stats: DashboardStats;
  categorySales: CategorySalesData[];
  medicinesCategorySales: CategorySalesData[];
  itemsCategorySales: CategorySalesData[];
  productPerformance: ProductPerformanceData[];
  topMedicines: ProductPerformanceData[];
  topItems: ProductPerformanceData[];
  paymentMethodData: PaymentMethodData[];
  creditOverview: { avgScore: number; atRisk: number; totalExposure: number; totalCustomers: number };
}

const MEDICINE_CATEGORIES = ['tablet', 'capsule', 'syrup', 'injection', 'cream', 'ointment', 'drops', 'inhaler'];

const EMPTY_OVERVIEW: DashboardOverview = {
  stats: { totalRevenue: 0, totalProducts: 0, totalMedicines: 0, totalItems: 0, totalSoldItems: 0, lowStockItems: 0, outOfStockItems: 0, expiredItems: 0 },
  categorySales: [], medicinesCategorySales: [], itemsCategorySales: [],
  productPerformance: [], topMedicines: [], topItems: [], paymentMethodData: [],
  creditOverview: { avgScore: 0, atRisk: 0, totalExposure: 0, totalCustomers: 0 },
};

function getStartDate(dateFilter: DateFilter): Date {
  const now = new Date();
  const d = new Date();
  if (dateFilter === 'daily') d.setHours(0, 0, 0, 0);
  else if (dateFilter === 'weekly') d.setDate(now.getDate() - 7);
  else if (dateFilter === 'monthly') d.setMonth(now.getMonth() - 1);
  else if (dateFilter === 'yearly') d.setFullYear(now.getFullYear() - 1);
  return d;
}

interface FetchArgs {
  selectedBranch: string | null;
  ownerBranchIds: string[];
  dateFilter: DateFilter;
  isOwner: boolean;
}

async function fetchDashboardOverview({ selectedBranch, ownerBranchIds, dateFilter, isOwner }: FetchArgs): Promise<DashboardOverview> {
  if (!selectedBranch && isOwner && ownerBranchIds.length === 0) {
    return EMPTY_OVERVIEW;
  }

  const now = new Date();
  const startDate = getStartDate(dateFilter);

  // Build all primary queries
  let salesQuery = supabase.from('sales')
    .select('total_amount, payment_method, discount_amount, branch_id, created_at')
    .gte('created_at', startDate.toISOString())
    .lte('created_at', now.toISOString());
  let branchItemsQuery = supabase.from('branch_items')
    .select('id, quantity, expiry_date, medicines!inner(category, minimum_stock_level)');
  let saleItemsQuery = supabase.from('sale_items')
    .select('quantity, sales!inner(branch_id, created_at)')
    .gte('sales.created_at', startDate.toISOString())
    .lte('sales.created_at', now.toISOString());
  let salesWithItemsQuery = supabase.from('sales')
    .select('*, sale_items (quantity, medicine_id, medicines (name, category))')
    .gte('created_at', startDate.toISOString())
    .lte('created_at', now.toISOString());
  let custQuery = supabase.from('customers').select('id, credit_score, max_credit_limit, branch_id');
  let salesDebtQuery = supabase.from('sales').select('total_amount, amount_paid, customer_id, branch_id').not('customer_id', 'is', null);

  if (selectedBranch) {
    salesQuery = salesQuery.eq('branch_id', selectedBranch);
    branchItemsQuery = branchItemsQuery.eq('branch_id', selectedBranch);
    saleItemsQuery = saleItemsQuery.eq('sales.branch_id', selectedBranch);
    salesWithItemsQuery = salesWithItemsQuery.eq('branch_id', selectedBranch);
    custQuery = custQuery.eq('branch_id', selectedBranch);
    salesDebtQuery = salesDebtQuery.eq('branch_id', selectedBranch);
  } else if (ownerBranchIds.length > 0) {
    salesQuery = salesQuery.in('branch_id', ownerBranchIds);
    branchItemsQuery = branchItemsQuery.in('branch_id', ownerBranchIds);
    saleItemsQuery = saleItemsQuery.in('sales.branch_id', ownerBranchIds);
    salesWithItemsQuery = salesWithItemsQuery.in('branch_id', ownerBranchIds);
    custQuery = custQuery.in('branch_id', ownerBranchIds);
    salesDebtQuery = salesDebtQuery.in('branch_id', ownerBranchIds);
  }

  // Fire all 6 queries in parallel
  const [salesRes, branchItemsRes, saleItemsRes, salesWithItemsRes, custRes, salesDebtRes] = await Promise.all([
    salesQuery, branchItemsQuery, saleItemsQuery, salesWithItemsQuery, custQuery, salesDebtQuery,
  ]);

  const salesData = salesRes.data || [];
  const branchItemsData = branchItemsRes.data || [];
  const saleItemsData = saleItemsRes.data || [];
  const salesWithItems = salesWithItemsRes.data || [];
  const custData = custRes.data || [];
  const salesDebt = salesDebtRes.data || [];

  // Stats
  const totalRevenue = salesData.reduce((sum, s: any) => sum + Number(s.total_amount), 0);
  const totalProducts = branchItemsData.length;
  const totalMedicines = branchItemsData.filter((bi: any) => MEDICINE_CATEGORIES.includes(bi.medicines?.category)).length;
  const totalItems = branchItemsData.filter((bi: any) => !MEDICINE_CATEGORIES.includes(bi.medicines?.category)).length;
  const lowStockItems = branchItemsData.filter((bi: any) => bi.quantity <= (bi.medicines?.minimum_stock_level || 0) && bi.quantity > 0).length;
  const outOfStockItems = branchItemsData.filter((bi: any) => bi.quantity === 0).length;
  const totalSoldItems = saleItemsData.reduce((sum, item: any) => sum + item.quantity, 0);
  const today = new Date().toISOString().split('T')[0];
  const expiredItems = branchItemsData.filter((bi: any) => bi.expiry_date && bi.quantity > 0 && bi.expiry_date <= today).length;

  // Category aggregations
  const categoryMap = new Map<string, { sales: number; revenue: number }>();
  const medicineCategoryMap = new Map<string, { sales: number; revenue: number }>();
  const itemCategoryMap = new Map<string, { sales: number; revenue: number }>();
  const productMap = new Map<string, { sales: number; revenue: number; category: string }>();

  salesWithItems.forEach((sale: any) => {
    const totalQty = sale.sale_items?.reduce((sum: number, si: any) => sum + si.quantity, 0) || 1;
    sale.sale_items?.forEach((item: any) => {
      if (!item.medicines) return;
      const category = item.medicines.category;
      const isMedicine = MEDICINE_CATEGORIES.includes(category);
      const itemRevenue = (Number(sale.total_amount) * item.quantity) / totalQty;

      const existing = categoryMap.get(category) || { sales: 0, revenue: 0 };
      categoryMap.set(category, { sales: existing.sales + item.quantity, revenue: existing.revenue + itemRevenue });

      const targetMap = isMedicine ? medicineCategoryMap : itemCategoryMap;
      const ex = targetMap.get(category) || { sales: 0, revenue: 0 };
      targetMap.set(category, { sales: ex.sales + item.quantity, revenue: ex.revenue + itemRevenue });

      const name = item.medicines.name;
      const pe = productMap.get(name) || { sales: 0, revenue: 0, category };
      productMap.set(name, { sales: pe.sales + item.quantity, revenue: pe.revenue + itemRevenue, category });
    });
  });

  const toArr = (map: Map<string, { sales: number; revenue: number }>) =>
    Array.from(map.entries()).map(([category, d]) => ({ category, ...d }));

  const productPerformance = Array.from(productMap.entries())
    .map(([name, d]) => ({ name, sales: d.sales, revenue: d.revenue }))
    .sort((a, b) => b.sales - a.sales)
    .slice(0, 10);

  const topMedicines = Array.from(productMap.entries())
    .filter(([, d]) => MEDICINE_CATEGORIES.includes(d.category))
    .map(([name, d]) => ({ name, sales: d.sales, revenue: d.revenue }))
    .sort((a, b) => b.sales - a.sales).slice(0, 10);

  const topItems = Array.from(productMap.entries())
    .filter(([, d]) => !MEDICINE_CATEGORIES.includes(d.category))
    .map(([name, d]) => ({ name, sales: d.sales, revenue: d.revenue }))
    .sort((a, b) => b.sales - a.sales).slice(0, 10);

  // Payment methods
  const paymentMap = new Map<string, number>();
  salesData.forEach((sale: any) => {
    const method = sale.payment_method || 'Cash';
    const amount = Number(sale.total_amount) - (Number(sale.discount_amount) || 0);
    paymentMap.set(method, (paymentMap.get(method) || 0) + amount);
  });
  const paymentMethodData = Array.from(paymentMap.entries()).map(([method, amount]) => ({ method, amount }));

  // Credit overview
  let creditOverview = { avgScore: 0, atRisk: 0, totalExposure: 0, totalCustomers: 0 };
  if (custData.length > 0) {
    const scores = custData.map((c: any) => c.credit_score ?? 50);
    const avgScore = Math.round(scores.reduce((a: number, b: number) => a + b, 0) / scores.length);
    const atRisk = scores.filter((s: number) => s < 30).length;
    const custIds = new Set(custData.map((c: any) => c.id));
    const totalExposure = salesDebt
      .filter((s: any) => custIds.has(s.customer_id))
      .reduce((sum: number, s: any) => sum + Math.max(0, Number(s.total_amount) - Number(s.amount_paid || 0)), 0);
    creditOverview = { avgScore, atRisk, totalExposure, totalCustomers: custData.length };
  }

  return {
    stats: { totalRevenue, totalProducts, totalMedicines, totalItems, totalSoldItems, lowStockItems, outOfStockItems, expiredItems },
    categorySales: toArr(categoryMap),
    medicinesCategorySales: toArr(medicineCategoryMap),
    itemsCategorySales: toArr(itemCategoryMap),
    productPerformance, topMedicines, topItems, paymentMethodData, creditOverview,
  };
}

export const DASHBOARD_STATS_KEY = (scope: { ownerId?: string; selectedBranch: string | null; dateFilter: DateFilter }) =>
  ['dashboard-stats', scope] as const;

export function useDashboardStats(dateFilter: DateFilter) {
  const { profile } = useAuth();
  const { selectedBranch } = useBranchContext();
  const { branchIds: cachedOwnerBranchIds, isLoading: ownerBranchesLoading } = useOwnerBranchIds();
  const queryClient = useQueryClient();

  const isOwner = profile?.role === 'owner';
  const enabled = !!profile && (!isOwner || !ownerBranchesLoading);

  const queryKey = useMemo(
    () => DASHBOARD_STATS_KEY({
      ownerId: isOwner ? profile?.id : undefined,
      selectedBranch,
      dateFilter,
    }),
    [isOwner, profile?.id, selectedBranch, dateFilter]
  );

  const query = useQuery({
    queryKey,
    queryFn: () => fetchDashboardOverview({
      selectedBranch,
      ownerBranchIds: cachedOwnerBranchIds,
      dateFilter,
      isOwner,
    }),
    enabled,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev, // instant hydration on revisit / filter change
  });

  // Pull-to-refresh interop
  useEffect(() => {
    const handler = () => queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
    window.addEventListener('app:refresh', handler);
    return () => window.removeEventListener('app:refresh', handler);
  }, [queryClient]);

  return {
    data: query.data ?? EMPTY_OVERVIEW,
    loading: query.isLoading,
    isFetching: query.isFetching,
    refetch: query.refetch,
    invalidate: () => queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] }),
  };
}
