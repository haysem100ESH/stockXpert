import { useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/db';
import { useAuth } from '@/hooks/useAuth';
import { useBranchContext } from '@/hooks/useBranchContext';

export default function ExpiringMedicinesAlert() {
  const { profile } = useAuth();
  const { userBranch, selectedBranch, branchType } = useBranchContext();
  const navigate = useNavigate();
  const [expiringCount, setExpiringCount] = useState(0);
  const [expiredCount, setExpiredCount] = useState(0);
  const [lowStockCount, setLowStockCount] = useState(0);
  const [outOfStockCount, setOutOfStockCount] = useState(0);

  useEffect(() => {
    fetchAlerts();
  }, [profile, userBranch, selectedBranch, branchType]);

  const getEffectiveBranchId = () => {
    if (profile?.role === 'staff') return userBranch || profile?.branch_id;
    return selectedBranch;
  };

  const fetchAlerts = async () => {
    try {
      const effectiveBranchId = getEffectiveBranchId();
      const today = new Date().toISOString().split('T')[0];
      const thirtyDaysFromNow = new Date();
      thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
      const thirtyDaysStr = thirtyDaysFromNow.toISOString().split('T')[0];

      // Build base filter
      const addBranchFilter = (q: any) => {
        if (profile?.role === 'staff') return q.eq('branch_id', userBranch || profile?.branch_id);
        if (effectiveBranchId) return q.eq('branch_id', effectiveBranchId);
        return q;
      };

      // Expiring soon (within 30 days, not yet expired)
      let expiringQ = supabase.from('medicines').select('id', { count: 'exact', head: true })
        .not('expiry_date', 'is', null)
        .gt('expiry_date', today)
        .lte('expiry_date', thirtyDaysStr);
      const { count: expiring } = await addBranchFilter(expiringQ);

      // Expired
      let expiredQ = supabase.from('medicines').select('id', { count: 'exact', head: true })
        .not('expiry_date', 'is', null)
        .lte('expiry_date', today);
      const { count: expired } = await addBranchFilter(expiredQ);

      // Out of stock
      let oosQ = supabase.from('medicines').select('id', { count: 'exact', head: true })
        .eq('stock_quantity', 0);
      const { count: oos } = await addBranchFilter(oosQ);

      // Low stock (stock > 0 but <= minimum)
      let lowQ = supabase.from('medicines').select('id, stock_quantity, minimum_stock_level')
        .gt('stock_quantity', 0);
      const { data: lowData } = await addBranchFilter(lowQ);
      const lowCount = (lowData || []).filter((m: any) => m.stock_quantity <= m.minimum_stock_level).length;

      setExpiringCount(expiring || 0);
      setExpiredCount(expired || 0);
      setOutOfStockCount(oos || 0);
      setLowStockCount(lowCount);
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
    navigate('/inventory?tab=alerts');
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
