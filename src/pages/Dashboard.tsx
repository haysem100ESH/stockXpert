import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import OwnerDashboard from '@/components/dashboard/OwnerDashboard';
import StaffDashboard from '@/components/dashboard/StaffDashboard';
import BranchSelector from '@/components/branch/BranchSelector';
import SubscriptionStatus from '@/components/subscription/SubscriptionStatus';

export default function Dashboard() {
  const { profile } = useAuth();
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);

  if (!profile) {
    return <div>Loading...</div>;
  }

  if (profile?.role === 'owner') {
    return (
      <div className="space-y-6">
        <SubscriptionStatus />
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
            <p className="text-muted-foreground">
              Welcome back, {profile.full_name}! Here's what's happening at your pharmacy.
            </p>
          </div>
          <BranchSelector 
            selectedBranch={selectedBranch}
            onBranchChange={setSelectedBranch}
            showAllOption={true}
          />
        </div>
        <OwnerDashboard selectedBranch={selectedBranch} />
      </div>
    );
  }

  if (profile?.role === 'staff') {
    return <StaffDashboard />;
  }

  return <div>Access denied. Please contact your administrator.</div>;
}