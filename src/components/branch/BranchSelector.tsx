import { useState, useEffect } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

interface Branch {
  id: string;
  name: string;
  is_main_branch: boolean;
}

interface BranchSelectorProps {
  selectedBranch: string | null;
  onBranchChange: (branchId: string | null) => void;
  showAllOption?: boolean;
}

export default function BranchSelector({ selectedBranch, onBranchChange, showAllOption = true }: BranchSelectorProps) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const { profile } = useAuth();

  useEffect(() => {
    fetchBranches();
  }, [profile]);

  const fetchBranches = async () => {
    try {
      let query = supabase
        .from('pharmacy_branches')
        .select('id, name, is_main_branch')
        .order('is_main_branch', { ascending: false })
        .order('created_at', { ascending: true });

      // Filter by pharmacy owner if user is an owner
      if (profile?.role === 'owner' && profile?.id) {
        query = query.eq('pharmacy_owner_id', profile.id);
      }

      const { data, error } = await query;

      if (error) throw error;
      setBranches(data || []);
    } catch (error) {
      console.error('Error fetching branches:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Select disabled>
        <SelectTrigger className="w-48">
          <SelectValue placeholder="Loading..." />
        </SelectTrigger>
      </Select>
    );
  }

  return (
    <Select value={selectedBranch || 'all'} onValueChange={(value) => onBranchChange(value === 'all' ? null : value)}>
      <SelectTrigger className="w-48">
        <SelectValue placeholder="Select branch" />
      </SelectTrigger>
      <SelectContent>
        {showAllOption && (
          <SelectItem value="all">All Branches</SelectItem>
        )}
        {branches.map((branch) => (
          <SelectItem key={branch.id} value={branch.id}>
            {branch.name} {branch.is_main_branch && '(Main)'}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}