import { ReactNode, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/AppSidebar';
import { LogOut } from 'lucide-react';
import { Loader2 } from 'lucide-react';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import SubscriptionStatus from '@/components/subscription/SubscriptionStatus';
import ExpiringMedicinesAlert from '@/components/inventory/ExpiringMedicinesAlert';
import { BranchProvider } from '@/hooks/useBranchContext';
import BranchSelector from '@/components/branch/BranchSelector';
import { useBranchContext } from '@/hooks/useBranchContext';

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const { user, profile, signOut, loading } = useAuth();
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  const handleSignOut = () => {
    setShowSignOutConfirm(true);
  };

  const confirmSignOut = async () => {
    setShowSignOutConfirm(false);
    await signOut();
  };

  return (
    <BranchProvider>
      <SidebarProvider>
        <div className="min-h-screen flex w-full">
          <AppSidebar />
          
          <div className="flex-1 flex flex-col">
            <LayoutHeader 
              profile={profile} 
              user={user} 
              onSignOut={handleSignOut} 
            />
            
            <main className="flex-1 overflow-auto p-4">
              {(profile?.role === 'owner' || profile?.role === 'staff') && <SubscriptionStatus />}
              <ExpiringMedicinesAlert />
              {children}
            </main>
          </div>
        </div>
        
        <ConfirmationDialog
          open={showSignOutConfirm}
          onOpenChange={setShowSignOutConfirm}
          title="Sign Out"
          description="Are you sure you want to sign out?"
          onConfirm={confirmSignOut}
          confirmText="Sign Out"
        />
      </SidebarProvider>
    </BranchProvider>
  );
}

function LayoutHeader({ profile, user, onSignOut }: { profile: any, user: any, onSignOut: () => void }) {
  const { selectedBranch, setSelectedBranch } = useBranchContext();
  
  return (
    <header className="border-b bg-card h-14 flex items-center justify-between px-4">
      <div className="flex items-center space-x-4">
        <SidebarTrigger className="ml-0" />
        
        {/* Branch Selector for Owners */}
        {profile?.role === 'owner' && (
          <BranchSelector
            selectedBranch={selectedBranch}
            onBranchChange={setSelectedBranch}
            showAllOption={true}
          />
        )}
      </div>
      
      <div className="flex items-center space-x-4">
        <div className="flex items-center space-x-2">
          <Avatar className="h-8 w-8">
            <AvatarFallback>
              {profile?.full_name.charAt(0).toUpperCase() || 'U'}
            </AvatarFallback>
          </Avatar>
          <span className="text-sm font-medium hidden sm:block">
            {profile?.full_name || user.email}
          </span>
        </div>
        <Button variant="outline" size="sm" onClick={onSignOut}>
          <LogOut className="h-4 w-4 mr-2" />
          <span className="hidden sm:inline">Sign Out</span>
        </Button>
      </div>
    </header>
  );
}