import { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from './useAuth';
import { supabase } from '@/integrations/supabase/client';

export type BranchType = 'pharmacy' | 'general';

interface BranchContextType {
  selectedBranch: string | null;
  setSelectedBranch: (branchId: string | null) => void;
  userBranch: string | null;
  branchType: BranchType;
}

const BranchContext = createContext<BranchContextType | undefined>(undefined);

export function BranchProvider({ children }: { children: React.ReactNode }) {
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [userBranch, setUserBranch] = useState<string | null>(null);
  const [branchType, setBranchType] = useState<BranchType>('pharmacy');
  const { profile, user } = useAuth();

  // Get user's assigned branch if they are staff, or owner's first branch
  useEffect(() => {
    const fetchUserBranch = async () => {
      if (profile?.role === 'staff' && user?.id) {
        try {
          // Get the branch_id directly from the profile since we have it in context
          if (profile.branch_id) {
            setUserBranch(profile.branch_id);
            setSelectedBranch(profile.branch_id); // Staff can only see their branch
          }
        } catch (error) {
          console.error('Error fetching user branch:', error);
        }
      } else if (profile?.role === 'owner' && profile?.id) {
        // Owners default to their first branch for better performance
        try {
          const { data: branches } = await supabase
            .from('pharmacy_branches')
            .select('id, branch_type')
            .eq('pharmacy_owner_id', profile.id)
            .order('is_main_branch', { ascending: false })
            .order('created_at', { ascending: true })
            .limit(1);
          
          if (branches && branches.length > 0) {
            setSelectedBranch(branches[0].id);
            setBranchType((branches[0] as any).branch_type || 'pharmacy');
          } else {
            setSelectedBranch(null); // No branches, default to "all"
          }
          setUserBranch(null); // Owners don't have a fixed branch
        } catch (error) {
          console.error('Error fetching owner branches:', error);
          setSelectedBranch(null);
          setUserBranch(null);
        }
      }
    };

    fetchUserBranch();
  }, [profile, user]);

  // Fetch branch type whenever selectedBranch changes (e.g. owner switches branch)
  useEffect(() => {
    const fetchBranchType = async () => {
      if (!selectedBranch) return;
      const { data } = await supabase
        .from('pharmacy_branches')
        .select('branch_type')
        .eq('id', selectedBranch)
        .single();
      if (data) {
        setBranchType((data as any).branch_type || 'pharmacy');
      }
    };
    fetchBranchType();
  }, [selectedBranch]);

  return (
    <BranchContext.Provider value={{ 
      selectedBranch, 
      setSelectedBranch: profile?.role === 'staff' ? () => {} : setSelectedBranch,
      userBranch,
      branchType
    }}>
      {children}
    </BranchContext.Provider>
  );
}

export function useBranchContext() {
  const context = useContext(BranchContext);
  if (context === undefined) {
    throw new Error('useBranchContext must be used within a BranchProvider');
  }
  return context;
}