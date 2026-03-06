import { useSubscription } from '@/hooks/useSubscription';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle, Lock, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';

export default function SubscriptionStatus() {
  const { subscription, isSubscriptionExpired, isSubscriptionExpiring, getDaysRemaining } = useSubscription();
  const navigate = useNavigate();
  const [hasShownWarning, setHasShownWarning] = useState(false);

  // Reset warning shown status when subscription changes
  useEffect(() => {
    setHasShownWarning(false);
  }, [subscription?.subscription_credit]);

  useEffect(() => {
    if ((isSubscriptionExpiring() || isSubscriptionExpired()) && !hasShownWarning) {
      setHasShownWarning(true);
    }
  }, [isSubscriptionExpiring, isSubscriptionExpired, hasShownWarning]);

  if (!subscription || !hasShownWarning) return null;

  if (isSubscriptionExpired()) {
    return (
      <Alert variant="destructive" className="mb-4">
        <Lock className="h-4 w-4" />
        <AlertDescription className="flex items-center justify-between">
          <span>🚫 Subscription expired. Please contact support to renew.</span>
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => navigate('/account')}
            className="ml-4"
          >
            Contact Support
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (isSubscriptionExpiring()) {
    const daysLeft = getDaysRemaining();
    return (
      <Alert variant="default" className="mb-4 border-amber-500 bg-amber-50 text-amber-800">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          ⚠ Subscription expires in {daysLeft} day{daysLeft !== 1 ? 's' : ''}. Please renew soon to continue using the system.
        </AlertDescription>
      </Alert>
    );
  }

  return null;
}