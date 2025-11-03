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
  const { userBranch, selectedBranch } = useBranchContext();
  const navigate = useNavigate();
  const [expiringCount, setExpiringCount] = useState(0);

  useEffect(() => {
    fetchExpiringMedicines();
  }, [profile, userBranch, selectedBranch]);

  const fetchExpiringMedicines = async () => {
    try {
      const thirtyDaysFromNow = new Date();
      thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
      
      // Determine which branch to filter by
      const effectiveBranchId = profile?.role === 'staff' ? userBranch : selectedBranch;
      
      let expiringQuery = supabase
        .from('medicines')
        .select('id', { count: 'exact', head: true })
        .not('expiry_date', 'is', null)
        .lte('expiry_date', thirtyDaysFromNow.toISOString().split('T')[0])
        .gte('expiry_date', new Date().toISOString().split('T')[0]);
      
      // Filter by branch
      if (profile?.role === 'staff') {
        expiringQuery = expiringQuery.eq('branch_id', userBranch || profile?.branch_id);
      } else if (effectiveBranchId) {
        expiringQuery = expiringQuery.eq('branch_id', effectiveBranchId);
      }
      
      const { count, error } = await expiringQuery;
      
      if (error) throw error;
      setExpiringCount(count || 0);
    } catch (error) {
      console.error('Error fetching expiring medicines:', error);
    }
  };

  if (expiringCount === 0) return null;

  return (
    <Alert variant="default" className="mb-4 border-amber-500 bg-amber-50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-200">
      <AlertTriangle className="h-4 w-4" />
      <AlertDescription className="flex items-center justify-between">
        <span>
          ⚠️ {expiringCount} medicine{expiringCount !== 1 ? 's' : ''} expiring within 30 days. Please review inventory.
        </span>
        <Button 
          variant="outline" 
          size="sm"
          onClick={() => navigate('/inventory')}
          className="ml-4 border-amber-600 text-amber-800 hover:bg-amber-100 dark:text-amber-200 dark:border-amber-400 dark:hover:bg-amber-950/40"
        >
          View Inventory
        </Button>
      </AlertDescription>
    </Alert>
  );
}
