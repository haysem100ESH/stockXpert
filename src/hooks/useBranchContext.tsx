import { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from './useAuth';
import { supabase } from '@/integrations/supabase/client';

interface BranchContextType {
  selectedBranch: string | null;
  setSelectedBranch: (branchId: string | null) => void;
  userBranch: string | null;
}

const BranchContext = createContext<BranchContextType | undefined>(undefined);

export function BranchProvider({ children }: { children: React.ReactNode }) {
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [userBranch, setUserBranch] = useState<string | null>(null);
  const { profile, user } = useAuth();

  // Get user's assigned branch if they are staff
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
      } else if (profile?.role === 'owner') {
        // Owners can switch branches, start with "all" branches
        setSelectedBranch(null);
        setUserBranch(null);
      }
    };

    fetchUserBranch();
  }, [profile, user]);

  return (
    <BranchContext.Provider value={{ 
      selectedBranch, 
      setSelectedBranch: profile?.role === 'staff' ? () => {} : setSelectedBranch, // Staff can't change branch
      userBranch
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