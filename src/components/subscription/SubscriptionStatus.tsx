import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle, CreditCard, Calendar, DollarSign } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface Subscription {
  id: string;
  subscription_credit: number;
  status: 'active' | 'expiring_soon' | 'expired';
  deposit_amount: number;
  created_at: string;
  updated_at: string;
}

interface PaymentRequest {
  id: string;
  amount: number;
  months_requested: number;
  payment_method: string;
  transaction_reference: string;
  status: 'pending' | 'approved' | 'declined';
  created_at: string;
}

const ETHIOPIAN_BANKS = [
  'Commercial Bank of Ethiopia',
  'Awash Bank',
  'Dashen Bank',
  'Bank of Abyssinia',
  'Wegagen Bank',
  'United Bank',
  'Nib International Bank',
  'Cooperative Bank of Oromia',
  'Lion International Bank',
  'Zemen Bank'
];

const MOBILE_PAYMENTS = [
  'Telebirr',
  'M-PESA',
  'CBE Birr',
  'Amole'
];

export default function SubscriptionStatus() {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [paymentRequests, setPaymentRequests] = useState<PaymentRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  
  // Payment form state
  const [monthsRequested, setMonthsRequested] = useState(1);
  const [paymentMethod, setPaymentMethod] = useState('');
  const [transactionRef, setTransactionRef] = useState('');
  const [amount, setAmount] = useState(0);

  useEffect(() => {
    if (user && profile?.role === 'owner') {
      fetchSubscriptionData();
    }
  }, [user, profile]);

  useEffect(() => {
    // Calculate amount based on months (100 birr per month as example)
    setAmount(monthsRequested * 100);
  }, [monthsRequested]);

  const fetchSubscriptionData = async () => {
    try {
      setLoading(true);
      
      // Fetch subscription
      const { data: subData, error: subError } = await supabase
        .from('pharmacy_subscriptions')
        .select('*')
        .eq('pharmacy_owner_id', user!.id)
        .single();

      if (subError && subError.code !== 'PGRST116') throw subError;
      
      setSubscription(subData);

      // Fetch payment requests
      const { data: paymentData, error: paymentError } = await supabase
        .from('payment_requests')
        .select('*')
        .eq('pharmacy_owner_id', user!.id)
        .order('created_at', { ascending: false });

      if (paymentError) throw paymentError;
      
      setPaymentRequests(paymentData || []);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const submitPaymentRequest = async () => {
    try {
      const { error } = await supabase
        .from('payment_requests')
        .insert({
          pharmacy_owner_id: user!.id,
          amount,
          months_requested: monthsRequested,
          payment_method: paymentMethod,
          transaction_reference: transactionRef,
          status: 'pending'
        });

      if (error) throw error;

      toast({
        title: "Success",
        description: "Payment request submitted successfully. We'll review it soon."
      });

      setShowPaymentDialog(false);
      fetchSubscriptionData();
      
      // Reset form
      setMonthsRequested(1);
      setPaymentMethod('');
      setTransactionRef('');
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const getStatusAlert = () => {
    if (!subscription) return null;

    if (subscription.status === 'expired') {
      return (
        <Alert className="border-red-200 bg-red-50">
          <AlertTriangle className="h-4 w-4 text-red-600" />
          <AlertDescription className="text-red-800">
            🚫 Your subscription has expired. Please renew to continue using the system.
          </AlertDescription>
        </Alert>
      );
    }

    if (subscription.status === 'expiring_soon') {
      return (
        <Alert className="border-yellow-200 bg-yellow-50">
          <AlertTriangle className="h-4 w-4 text-yellow-600" />
          <AlertDescription className="text-yellow-800">
            ⚠ Your subscription expires in {subscription.subscription_credit} days. Please renew soon.
          </AlertDescription>
        </Alert>
      );
    }

    return null;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge className="bg-green-100 text-green-800">Active</Badge>;
      case 'expiring_soon':
        return <Badge className="bg-yellow-100 text-yellow-800">Expiring Soon</Badge>;
      case 'expired':
        return <Badge className="bg-red-100 text-red-800">Expired</Badge>;
      default:
        return <Badge className="bg-gray-100 text-gray-800">Unknown</Badge>;
    }
  };

  const getPaymentStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge className="bg-blue-100 text-blue-800">Pending Review</Badge>;
      case 'approved':
        return <Badge className="bg-green-100 text-green-800">Approved</Badge>;
      case 'declined':
        return <Badge className="bg-red-100 text-red-800">Declined</Badge>;
      default:
        return <Badge className="bg-gray-100 text-gray-800">Unknown</Badge>;
    }
  };

  if (profile?.role !== 'owner') {
    return null;
  }

  if (loading) {
    return <div className="animate-pulse h-32 bg-gray-200 rounded-lg"></div>;
  }

  return (
    <div className="space-y-6">
      {getStatusAlert()}
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Subscription Status Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              Subscription Status
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {subscription ? (
              <>
                <div className="flex items-center justify-between">
                  <span>Status:</span>
                  {getStatusBadge(subscription.status)}
                </div>
                <div className="flex items-center justify-between">
                  <span>Days Remaining:</span>
                  <span className="font-bold">{subscription.subscription_credit}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Deposit Balance:</span>
                  <span className="font-bold">{subscription.deposit_amount} ETB</span>
                </div>
              </>
            ) : (
              <p className="text-muted-foreground">No subscription found</p>
            )}
            
            <Dialog open={showPaymentDialog} onOpenChange={setShowPaymentDialog}>
              <DialogTrigger asChild>
                <Button className="w-full">Request Credit Top-up</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Request Subscription Credit</DialogTitle>
                  <DialogDescription>
                    Submit a payment request to add credit to your subscription
                  </DialogDescription>
                </DialogHeader>
                
                <div className="space-y-4">
                  <div>
                    <Label>Subscription Duration</Label>
                    <Select value={monthsRequested.toString()} onValueChange={(val) => setMonthsRequested(Number(val))}>
                      <SelectTrigger className="mt-2">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">1 Month - 100 ETB</SelectItem>
                        <SelectItem value="2">2 Months - 200 ETB</SelectItem>
                        <SelectItem value="3">3 Months - 300 ETB</SelectItem>
                        <SelectItem value="6">6 Months - 600 ETB</SelectItem>
                        <SelectItem value="12">12 Months - 1200 ETB</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label>Payment Method</Label>
                    <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                      <SelectTrigger className="mt-2">
                        <SelectValue placeholder="Select payment method" />
                      </SelectTrigger>
                      <SelectContent>
                        {ETHIOPIAN_BANKS.map(bank => (
                          <SelectItem key={bank} value={bank}>{bank}</SelectItem>
                        ))}
                        {MOBILE_PAYMENTS.map(mobile => (
                          <SelectItem key={mobile} value={mobile}>{mobile}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label>Transaction Reference</Label>
                    <Input
                      className="mt-2"
                      value={transactionRef}
                      onChange={(e) => setTransactionRef(e.target.value)}
                      placeholder="Enter transaction reference number"
                    />
                  </div>

                  <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                    <span className="font-medium">Total Amount:</span>
                    <span className="text-xl font-bold">{amount} ETB</span>
                  </div>

                  <Button 
                    onClick={submitPaymentRequest}
                    disabled={!paymentMethod || !transactionRef}
                    className="w-full"
                  >
                    Submit Payment Request
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>

        {/* Payment Requests */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              Recent Payment Requests
            </CardTitle>
          </CardHeader>
          <CardContent>
            {paymentRequests.length > 0 ? (
              <div className="space-y-3">
                {paymentRequests.slice(0, 3).map((request) => (
                  <div key={request.id} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="space-y-1">
                      <p className="font-medium">{request.amount} ETB</p>
                      <p className="text-sm text-muted-foreground">
                        {request.months_requested} month{request.months_requested > 1 ? 's' : ''}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(request.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    {getPaymentStatusBadge(request.status)}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground">No payment requests yet</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}