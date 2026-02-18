import { useState, useEffect } from 'react';
import { supabase } from '@/lib/db';
import { useAuth } from '@/hooks/useAuth';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle, Lock } from 'lucide-react';

interface SubscriptionGuardProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export default function SubscriptionGuard({ children, fallback }: SubscriptionGuardProps) {
  const { user, profile } = useAuth();
  const [subscriptionStatus, setSubscriptionStatus] = useState<'active' | 'expiring_soon' | 'expired' | 'inactive' | 'loading'>('loading');
  const [daysRemaining, setDaysRemaining] = useState<number>(0);

  useEffect(() => {
    if (user && profile?.role === 'owner') {
      checkSubscriptionStatus();
    } else if (profile?.role === 'staff' || profile?.role === 'developer') {
      // Staff and developers can always access
      setSubscriptionStatus('active');
    }
  }, [user, profile]);

  const checkSubscriptionStatus = async () => {
    try {
      const { data, error } = await supabase
        .from('pharmacy_subscriptions')
        .select('subscription_credit, status')
        .eq('pharmacy_owner_id', user!.id)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('Error checking subscription:', error);
        setSubscriptionStatus('expired');
        return;
      }

      if (!data) {
        setSubscriptionStatus('expired');
        return;
      }

      setDaysRemaining(data.subscription_credit);
      setSubscriptionStatus(data.status);
    } catch (error) {
      console.error('Error checking subscription:', error);
      setSubscriptionStatus('expired');
    }
  };

  if (subscriptionStatus === 'loading') {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  // If subscription is expired or inactive, show blocked access
  if (subscriptionStatus === 'expired' || subscriptionStatus === 'inactive') {
    const isInactive = subscriptionStatus === 'inactive';
    const blockedContent = fallback || (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="max-w-md mx-auto">
          <CardHeader className="text-center">
            <div className="mx-auto w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
              <Lock className="h-6 w-6 text-red-600" />
            </div>
            <CardTitle className="text-red-600">
              {isInactive ? 'Account Deactivated' : 'Subscription Expired'}
            </CardTitle>
            <CardDescription>
              {isInactive 
                ? 'Your account has been deactivated by the system administrator.'
                : 'Your subscription has expired. Please contact support to renew your subscription.'
              }
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <Alert className="border-red-200 bg-red-50">
              <AlertTriangle className="h-4 w-4 text-red-600" />
              <AlertDescription className="text-red-800">
                🚫 {isInactive 
                  ? 'Your account has been deactivated by the system administrator. Please contact support.'
                  : 'Access blocked until subscription is renewed'
                }
              </AlertDescription>
            </Alert>
            <p className="text-sm text-muted-foreground">
              Contact our support team {isInactive ? 'for assistance' : 'to renew your subscription and regain access to all features'}.
            </p>
            <div className="space-y-2 text-sm">
              <p><strong>Email:</strong> support@pharmaxpert.com</p>
              <p><strong>Phone:</strong> +251-911-123456</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );

    return <>{blockedContent}</>;
  }

  // If subscription is expiring soon, show children normally (warning handled by SubscriptionStatus component)
  // Active subscription - show children normally
  return <>{children}</>;
}