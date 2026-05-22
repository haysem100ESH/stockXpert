import { useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/db';
import { useAuth } from '@/hooks/useAuth';
import { useBranchContext } from '@/hooks/useBranchContext';
import { useExpiryThreshold } from '@/hooks/useExpiryThreshold';

export default function ExpiringMedicinesAlert() {
  const { profile } = useAuth();
  const { userBranch, selectedBranch, branchType } = useBranchContext();
  const { days: thresholdDays } = useExpiryThreshold();
  const navigate = useNavigate();
  const [expiringCount, setExpiringCount] = useState(0);
  const [expiredCount, setExpiredCount] = useState(0);
  const [lowStockCount, setLowStockCount] = useState(0);
  const [outOfStockCount, setOutOfStockCount] = useState(0);

  useEffect(() => {
    fetchAlerts();
  }, [profile, userBranch, selectedBranch, branchType, thresholdDays]);

  const getEffectiveBranchId = () => {
    if (profile?.role === 'staff') return userBranch || profile?.branch_id;
    return selectedBranch;
  };

  const fetchAlerts = async () => {
    try {
      const effectiveBranchId = getEffectiveBranchId();
      const today = new Date().toISOString().split('T')[0];
      const thresholdDate = new Date();
      thresholdDate.setDate(thresholdDate.getDate() + thresholdDays);
      const thresholdStr = thresholdDate.toISOString().split('T')[0];

      // Get owner's branch IDs when viewing "All Branches"
      let ownerBranchIds: string[] = [];
      if (!effectiveBranchId && profile?.role === 'owner' && profile?.id) {
        const { data: ownerBranches } = await supabase
          .from('pharmacy_branches')
          .select('id')
          .eq('pharmacy_owner_id', profile.id);
        ownerBranchIds = (ownerBranches || []).map((b: any) => b.id);
        
        if (ownerBranchIds.length === 0) {
          setExpiringCount(0);
          setExpiredCount(0);
          setOutOfStockCount(0);
          setLowStockCount(0);
          return;
        }
      }

      const addBranchFilter = (q: any) => {
        if (profile?.role === 'staff') {
          const sid = userBranch || profile?.branch_id;
          if (!sid) return null;
          return q.eq('branch_id', sid);
        }
        if (effectiveBranchId) return q.eq('branch_id', effectiveBranchId);
        if (profile?.role === 'owner' && ownerBranchIds.length > 0) return q.in('branch_id', ownerBranchIds);
        // Owner with no branches OR unknown role: do not leak cross-owner data
        return null;
      };

      // Fetch all branch_items (parent-level stock + min stock)
      let query: any = supabase
        .from('branch_items')
        .select('id, medicine_id, quantity, medicines!inner(minimum_stock_level)');
      query = addBranchFilter(query);
      if (!query) {
        setExpiringCount(0);
        setExpiredCount(0);
        setOutOfStockCount(0);
        setLowStockCount(0);
        return;
      }
      const { data: items } = await query;

      // Fetch batch-level expiry data
      let batchQuery: any = supabase
        .from('inventory_batches')
        .select('id, medicine_id, branch_id, remaining_quantity, expiry_date');
      batchQuery = addBranchFilter(batchQuery);
      const { data: batches } = batchQuery ? await batchQuery : { data: [] };

      if ((!items || items.length === 0) && (!batches || batches.length === 0)) {
        setExpiringCount(0);
        setExpiredCount(0);
        setOutOfStockCount(0);
        setLowStockCount(0);
        return;
      }

      let oos = 0, low = 0;
      for (const item of (items || []) as any[]) {
        if (item.quantity === 0) {
          oos++;
        } else if (item.medicines?.minimum_stock_level && item.quantity <= item.medicines.minimum_stock_level) {
          low++;
        }
      }

      // Expiry counted per batch (unique parents per bucket so badge counts parent items)
      const expiredParents = new Set<string>();
      const expiringParents = new Set<string>();
      for (const b of (batches || []) as any[]) {
        if (!b.expiry_date || Number(b.remaining_quantity) <= 0) continue;
        if (b.expiry_date <= today) expiredParents.add(b.medicine_id);
        else if (b.expiry_date <= thresholdStr) expiringParents.add(b.medicine_id);
      }

      setExpiringCount(expiringParents.size);
      setExpiredCount(expiredParents.size);
      setOutOfStockCount(oos);
      setLowStockCount(low);
    } catch (error) {
      console.error('Error fetching inventory alerts:', error);
    }
  };

  const totalAlerts = expiringCount + expiredCount + lowStockCount + outOfStockCount;
  if (totalAlerts === 0) return null;

  const parts: string[] = [];
  if (expiredCount > 0) parts.push(`${expiredCount} expired`);
  if (expiringCount > 0) parts.push(`${expiringCount} expiring soon`);
  if (outOfStockCount > 0) parts.push(`${outOfStockCount} out of stock`);
  if (lowStockCount > 0) parts.push(`${lowStockCount} low stock`);

  const handleViewAlerts = () => {
    navigate('/smart-inventory');
  };

  return (
    <Alert variant="default" className="mb-4 border-amber-500 bg-amber-50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-200">
      <AlertTriangle className="h-4 w-4 flex-shrink-0" />
      <AlertDescription className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <span className="text-sm">⚠️ Inventory alerts: {parts.join(', ')}.</span>
        <Button variant="outline" size="sm" onClick={handleViewAlerts} className="flex-shrink-0 border-amber-600 text-amber-800 hover:bg-amber-100 dark:text-amber-200 dark:border-amber-400 dark:hover:bg-amber-950/40 w-fit">View Alerts</Button>
      </AlertDescription>
    </Alert>
  );
}
