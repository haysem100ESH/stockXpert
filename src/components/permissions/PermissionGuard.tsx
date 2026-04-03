import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useStaffPermissions, type PageName } from '@/hooks/useStaffPermissions';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ShieldAlert } from 'lucide-react';

interface PermissionGuardProps {
  page: PageName;
  children: ReactNode;
}

export default function PermissionGuard({ page, children }: PermissionGuardProps) {
  const { profile } = useAuth();
  const { getPermission, loading } = useStaffPermissions();

  // Owners/developers bypass
  if (!profile || profile.role !== 'staff') return <>{children}</>;
  if (loading) return null;

  const level = getPermission(page);

  if (level === 'no_access') {
    return <Navigate to="/" replace />;
  }

  return (
    <>
      {level === 'read' && (
        <Alert className="mb-4 border-warning/50 bg-warning/10">
          <ShieldAlert className="h-4 w-4" />
          <AlertDescription className="text-sm font-medium">
            Read Only Mode — You can view this page but cannot make changes.
          </AlertDescription>
        </Alert>
      )}
      {children}
    </>
  );
}
