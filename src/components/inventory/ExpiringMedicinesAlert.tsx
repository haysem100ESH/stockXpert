import { useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useBranchContext } from '@/hooks/useBranchContext';

export default function ExpiringMedicinesAlert() {
  const { profile } = useAuth();
  const { userBranch, selectedBranch, branchType } = useBranchContext();
  const navigate = useNavigate();
  const [expiringCount, setExpiringCount] = useState(0);

  // Hide this alert entirely for general inventory branches
  const isPharmacy = branchType === 'pharmacy';

  useEffect(() => {
    if (isPharmacy) fetchExpiringMedicines();
    else setExpiringCount(0);
  }, [profile, userBranch, selectedBranch, branchType]);

  const fetchExpiringMedicines = async () => {
    try {
      const thirtyDaysFromNow = new Date();
      thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
      const effectiveBranchId = profile?.role === 'staff' ? userBranch : selectedBranch;
      
      let expiringQuery = supabase.from('medicines').select('id', { count: 'exact', head: true }).not('expiry_date', 'is', null).lte('expiry_date', thirtyDaysFromNow.toISOString().split('T')[0]).gte('expiry_date', new Date().toISOString().split('T')[0]);
      
      if (profile?.role === 'staff') { expiringQuery = expiringQuery.eq('branch_id', userBranch || profile?.branch_id); }
      else if (effectiveBranchId) { expiringQuery = expiringQuery.eq('branch_id', effectiveBranchId); }
      
      const { count, error } = await expiringQuery;
      if (error) throw error;
      setExpiringCount(count || 0);
    } catch (error) {
      console.error('Error fetching expiring medicines:', error);
    }
  };

  if (!isPharmacy || expiringCount === 0) return null;

  return (
    <Alert variant="default" className="mb-4 border-amber-500 bg-amber-50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-200">
      <AlertTriangle className="h-4 w-4" />
      <AlertDescription className="flex items-center justify-between">
        <span>⚠️ {expiringCount} medicine{expiringCount !== 1 ? 's' : ''} expiring within 30 days. Please review inventory.</span>
        <Button variant="outline" size="sm" onClick={() => navigate('/inventory')} className="ml-4 border-amber-600 text-amber-800 hover:bg-amber-100 dark:text-amber-200 dark:border-amber-400 dark:hover:bg-amber-950/40">View Inventory</Button>
      </AlertDescription>
    </Alert>
  );
}
