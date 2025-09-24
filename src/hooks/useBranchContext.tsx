import { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from './useAuth';

interface BranchContextType {
  selectedBranch: string | null;
  setSelectedBranch: (branchId: string | null) => void;
}

const BranchContext = createContext<BranchContextType | undefined>(undefined);

export function BranchProvider({ children }: { children: React.ReactNode }) {
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const { profile } = useAuth();

  // Staff users should have a fixed branch, owners can switch
  useEffect(() => {
    if (profile?.role === 'staff') {
      // For staff, we'll need to get their assigned branch from the database
      // For now, set to null and they'll be restricted by RLS policies
      setSelectedBranch(null);
    }
  }, [profile]);

  return (
    <BranchContext.Provider value={{ selectedBranch, setSelectedBranch }}>
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