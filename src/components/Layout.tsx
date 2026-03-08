import { ReactNode, useState, useEffect } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/AppSidebar';
import { LogOut, Settings, Sun, Moon } from 'lucide-react';
import { Loader2 } from 'lucide-react';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import SubscriptionStatus from '@/components/subscription/SubscriptionStatus';
import ExpiringMedicinesAlert from '@/components/inventory/ExpiringMedicinesAlert';
import { BranchProvider } from '@/hooks/useBranchContext';
import SmartAssistant from '@/components/chat/SmartAssistant';
import BranchSelector from '@/components/branch/BranchSelector';
import { useBranchContext } from '@/hooks/useBranchContext';
import { useBranding } from '@/hooks/useBranding';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

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
          
          <div className="flex-1 flex flex-col min-w-0 overflow-x-hidden">
            <LayoutHeader 
              profile={profile} 
              user={user} 
              onSignOut={handleSignOut} 
            />
            
            <main className="flex-1 overflow-x-hidden overflow-y-auto p-2 sm:p-4 max-w-full">
              {(profile?.role === 'owner' || profile?.role === 'staff') && <SubscriptionStatus />}
              <ExpiringMedicinesAlert />
              {children}
            </main>
            
            {/* AI Smart Assistant */}
            {profile?.role !== 'developer' && <SmartAssistant />}
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
  const branding = useBranding();
  const navigate = useNavigate();

  useEffect(() => {
    document.title = branding.systemName;
  }, [branding.systemName]);
  
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center space-x-2 cursor-pointer rounded-full hover:bg-muted p-1 transition-colors">
              <Avatar className="h-8 w-8">
                <AvatarFallback>
                  {profile?.full_name.charAt(0).toUpperCase() || 'U'}
                </AvatarFallback>
              </Avatar>
              <span className="text-sm font-medium hidden sm:block">
                {profile?.full_name || user.email}
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium">{profile?.full_name}</p>
                <p className="text-xs text-muted-foreground">{user.email}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate('/account')}>
              <Settings className="mr-2 h-4 w-4" />
              Open Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onSignOut}>
              <LogOut className="mr-2 h-4 w-4" />
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}