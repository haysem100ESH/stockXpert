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

  if (level === 'read') {
    return (
      <>
        <Alert className="mb-4 border-warning/50 bg-warning/10">
          <ShieldAlert className="h-4 w-4" />
          <AlertDescription className="text-sm font-medium">
            Read Only Mode — You can view this page but cannot make changes.
          </AlertDescription>
        </Alert>
        <fieldset
          disabled
          className="contents [&_button:not([data-readonly-allow])]:pointer-events-none [&_button:not([data-readonly-allow])]:opacity-60 [&_a[role=button]]:pointer-events-none"
          onClickCapture={(e) => {
            const target = e.target as HTMLElement;
            // Allow navigation links, tabs, dialog close buttons
            if (target.closest('[data-readonly-allow]')) return;
            const interactive = target.closest('button, [role="menuitem"], [role="tab"], input, textarea, select, [contenteditable="true"]');
            if (interactive && !interactive.closest('[data-readonly-allow]')) {
              // Allow tabs and dialog-close (they have specific roles or aria-labels)
              const role = interactive.getAttribute('role');
              const ariaLabel = interactive.getAttribute('aria-label') || '';
              if (role === 'tab' || ariaLabel.toLowerCase().includes('close') || ariaLabel.toLowerCase().includes('search')) return;
              e.preventDefault();
              e.stopPropagation();
            }
          }}
          onKeyDownCapture={(e) => {
            const target = e.target as HTMLElement;
            if (target.matches('input, textarea, [contenteditable="true"]') && !target.closest('[data-readonly-allow]')) {
              // Allow navigation/search keys
              if (['Tab', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
              if ((e.ctrlKey || e.metaKey) && ['a', 'c'].includes(e.key.toLowerCase())) return;
              e.preventDefault();
              e.stopPropagation();
            }
          }}
        >
          <div className="contents">{children}</div>
        </fieldset>
      </>
    );
  }

  return <>{children}</>;
}
