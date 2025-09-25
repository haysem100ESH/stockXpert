import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Users, Building, CreditCard, AlertTriangle, Wallet, FileText, CheckCircle, XCircle, DollarSign, Edit, Trash2 } from 'lucide-react';
import CreateOwnerDialog from './CreateOwnerDialog';
import EditOwnerDialog from './EditOwnerDialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface PharmacyOwner {
  id: string;
  full_name: string;
  email: string;
  phone?: string;
  pharmacy_address?: string;
  active: boolean;
  subscription: {
    subscription_credit: number;
    status: string;
    deposit_amount: number;
    last_credit_deduction: string;
  } | null;
  branch_count: number;
  pending_payments: number;
}

interface PaymentRequest {
  id: string;
  pharmacy_owner_id: string;
  pharmacy_owner_name: string;
  amount: number;
  months_requested: number;
  payment_method: string;
  transaction_reference: string;
  status: string;
  created_at: string;
}

export default function DeveloperDashboard() {
  const [owners, setOwners] = useState<PharmacyOwner[]>([]);
  const [paymentRequests, setPaymentRequests] = useState<PaymentRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [paymentLoading, setPaymentLoading] = useState(true);
  const [selectedOwner, setSelectedOwner] = useState<PharmacyOwner | null>(null);
  const [editOwner, setEditOwner] = useState<PharmacyOwner | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [creditDialogOpen, setCreditDialogOpen] = useState(false);
  const [depositDialogOpen, setDepositDialogOpen] = useState(false);
  const [creditAmount, setCreditAmount] = useState<number>(30);
  const [depositAmount, setDepositAmount] = useState<number>(0);
  const { toast } = useToast();

  useEffect(() => {
    fetchPharmacyOwners();
    fetchPaymentRequests();
  }, []);

  const fetchPharmacyOwners = async () => {
    try {
      setLoading(true);
      
      // Get all pharmacy owners with their subscription data and counts
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select(`
          id, 
          full_name,
          phone,
          pharmacy_address,
          active,
          created_at
        `)
        .eq('role', 'owner');

      if (profilesError) throw profilesError;

      if (!profiles || profiles.length === 0) {
        console.log('No pharmacy owners found');
        setOwners([]);
        return;
      }

      // Get additional data for each owner
      const ownersWithData = await Promise.all(
        profiles.map(async (profile: any) => {
          // Get actual email from auth.users via get_profile_by_email function
          // Since we can't directly access auth.users, use a fallback email
          const email = `${profile.full_name.toLowerCase().replace(/\s+/g, '')}@pharmacy.com`;

          // Get subscription data - use maybeSingle to handle cases where no subscription exists
          const { data: subscription } = await supabase
            .from('pharmacy_subscriptions')
            .select('subscription_credit, status, deposit_amount, last_credit_deduction')
            .eq('pharmacy_owner_id', profile.id)
            .maybeSingle();

          // Get branch count
          const { count: branchCount } = await supabase
            .from('pharmacy_branches')
            .select('id', { count: 'exact' })
            .eq('pharmacy_owner_id', profile.id);

          // Get pending payment requests count
          const { count: pendingPayments } = await supabase
            .from('payment_requests')
            .select('id', { count: 'exact' })
            .eq('pharmacy_owner_id', profile.id)
            .eq('status', 'pending');

          return {
            id: profile.id,
            full_name: profile.full_name,
            email,
            phone: profile.phone,
            pharmacy_address: profile.pharmacy_address,
            active: profile.active,
            subscription: subscription || {
              subscription_credit: 0,
              status: 'expired',
              deposit_amount: 0,
              last_credit_deduction: new Date().toISOString()
            },
            branch_count: branchCount || 0,
            pending_payments: pendingPayments || 0
          };
        })
      );

      console.log('Fetched pharmacy owners:', ownersWithData);
      setOwners(ownersWithData);
    } catch (error: any) {
      console.error('Error fetching pharmacy owners:', error);
      toast({
        title: "Error",
        description: "Failed to fetch pharmacy owners data",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchPaymentRequests = async () => {
    try {
      setPaymentLoading(true);
      
      const { data, error } = await supabase
        .from('payment_requests')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Get owner names for each payment request
      const requestsWithOwnerNames = await Promise.all(
        (data || []).map(async (request: any) => {
          const { data: ownerData } = await supabase
            .from('profiles')
            .select('full_name')
            .eq('id', request.pharmacy_owner_id)
            .single();

          return {
            ...request,
            pharmacy_owner_name: ownerData?.full_name || 'Unknown'
          };
        })
      );

      setPaymentRequests(requestsWithOwnerNames);
    } catch (error: any) {
      console.error('Error fetching payment requests:', error);
      toast({
        title: "Error",
        description: "Failed to fetch payment requests",
        variant: "destructive"
      });
    } finally {
      setPaymentLoading(false);
    }
  };

  const addCredit = async (ownerId: string, days: number) => {
    try {
      // Get current subscription first
      const { data: currentSub } = await supabase
        .from('pharmacy_subscriptions')
        .select('subscription_credit')
        .eq('pharmacy_owner_id', ownerId)
        .single();

      const newCredit = (currentSub?.subscription_credit || 0) + days;
      let newStatus: 'active' | 'expiring_soon' | 'expired';

      if (newCredit <= 0) {
        newStatus = 'expired';
      } else if (newCredit <= 7) {
        newStatus = 'expiring_soon';
      } else {
        newStatus = 'active';
      }

      const { error } = await supabase
        .from('pharmacy_subscriptions')
        .upsert({
          pharmacy_owner_id: ownerId,
          subscription_credit: newCredit,
          status: newStatus
        }, {
          onConflict: 'pharmacy_owner_id'
        });

      if (error) throw error;

      // If adding credit and status becomes active, reactivate the account
      if (newStatus === 'active' || newStatus === 'expiring_soon') {
        await supabase
          .from('profiles')
          .update({ active: true })
          .eq('id', ownerId)
          .eq('role', 'owner');
      }

      toast({
        title: "Success",
        description: `Added ${days} days credit successfully. Account ${newStatus === 'active' || newStatus === 'expiring_soon' ? 'activated' : 'remains deactivated'}.`
      });

      setCreditDialogOpen(false);
      fetchPharmacyOwners();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const updateDeposit = async (ownerId: string, amount: number) => {
    try {
      const { error } = await supabase
        .from('pharmacy_subscriptions')
        .upsert({
          pharmacy_owner_id: ownerId,
          deposit_amount: amount
        }, {
          onConflict: 'pharmacy_owner_id'
        });

      if (error) throw error;

      toast({
        title: "Success",
        description: "Deposit amount updated successfully"
      });

      setDepositDialogOpen(false);
      fetchPharmacyOwners();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const approvePayment = async (requestId: string, ownerId: string, monthsRequested: number) => {
    try {
      // First approve the payment request
      const { error: approveError } = await supabase
        .from('payment_requests')
        .update({ status: 'approved' })
        .eq('id', requestId);

      if (approveError) throw approveError;

      // Then add credit to the subscription
      const daysToAdd = monthsRequested * 30;
      await addCredit(ownerId, daysToAdd);

      toast({
        title: "Success",
        description: `Payment approved and ${daysToAdd} days credit added`
      });

      fetchPaymentRequests();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const declinePayment = async (requestId: string) => {
    try {
      const { error } = await supabase
        .from('payment_requests')
        .update({ status: 'declined' })
        .eq('id', requestId);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Payment request declined"
      });

      fetchPaymentRequests();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const triggerDailyDeduction = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('daily-credit-deduction', {
        body: { manual: true }
      });

      if (error) throw error;

      toast({
        title: "Success",
        description: "Daily credit deduction triggered successfully"
      });

      fetchPharmacyOwners();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const deleteOwner = async (ownerId: string, ownerName: string) => {
    if (!confirm(`Are you sure you want to delete ${ownerName}? This action cannot be undone.`)) {
      return;
    }

    try {
      // Delete from profiles table (cascading will handle related data)
      const { error } = await supabase
        .from('profiles')
        .delete()
        .eq('id', ownerId);

      if (error) throw error;

      toast({
        title: "Success",
        description: `${ownerName} has been deleted successfully`
      });

      fetchPharmacyOwners();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to delete owner",
        variant: "destructive"
      });
    }
  };

  const handleEditOwner = (owner: PharmacyOwner) => {
    setEditOwner(owner);
    setEditDialogOpen(true);
  };

  const getStatusBadge = (status: string | null) => {
    switch (status) {
      case 'active':
        return <Badge className="bg-green-100 text-green-800">Active</Badge>;
      case 'expiring_soon':
        return <Badge className="bg-yellow-100 text-yellow-800">Expiring Soon</Badge>;
      case 'expired':
        return <Badge className="bg-red-100 text-red-800">Expired</Badge>;
      default:
        return <Badge className="bg-gray-100 text-gray-800">No Subscription</Badge>;
    }
  };

  const getAccountStatusBadge = (active: boolean) => {
    return active 
      ? <Badge className="bg-green-100 text-green-800">Active</Badge>
      : <Badge className="bg-red-100 text-red-800">Deactivated</Badge>;
  };

  if (loading) {
    return <div className="flex justify-center items-center h-64">Loading...</div>;
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Developer Dashboard</h1>
          <p className="text-muted-foreground">Manage pharmacy owners and subscriptions</p>
        </div>
        <div className="flex gap-2">
          <CreateOwnerDialog onOwnerCreated={fetchPharmacyOwners} />
          <Button variant="outline" onClick={fetchPharmacyOwners}>Refresh Data</Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Owners</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{owners.length}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Subscriptions</CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {owners.filter(o => o.subscription?.status === 'active').length}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Branches</CardTitle>
            <Building className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {owners.reduce((sum, o) => sum + o.branch_count, 0)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Payments</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {owners.reduce((sum, o) => sum + o.pending_payments, 0)}
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="owners" className="w-full">
        <TabsList>
          <TabsTrigger value="owners">Pharmacy Owners</TabsTrigger>
          <TabsTrigger value="payments">Payment Requests</TabsTrigger>
        </TabsList>
        
        <TabsContent value="owners">
          <Card>
            <CardHeader>
              <CardTitle>Pharmacy Owners</CardTitle>
              <CardDescription>Manage owner accounts, subscriptions, and activation status</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Owner Name</TableHead>
                    <TableHead>Account Status</TableHead>
                    <TableHead>Subscription</TableHead>
                    <TableHead>Credit (Days)</TableHead>
                    <TableHead>Branches</TableHead>
                    <TableHead>Deposit</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {owners.map((owner) => (
                    <TableRow key={owner.id}>
                      <TableCell>
                        <div>
                          <div className="font-medium">{owner.full_name}</div>
                          <div className="text-sm text-muted-foreground">{owner.email}</div>
                        </div>
                      </TableCell>
                      <TableCell>{getAccountStatusBadge(owner.active)}</TableCell>
                      <TableCell>{getStatusBadge(owner.subscription?.status || null)}</TableCell>
                      <TableCell>{owner.subscription?.subscription_credit || 0}</TableCell>
                      <TableCell>{owner.branch_count}</TableCell>
                      <TableCell>${owner.subscription?.deposit_amount || 0}</TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => handleEditOwner(owner)}
                          >
                            <Edit className="h-4 w-4 mr-1" />
                            Edit
                          </Button>
                          
                          <Dialog>
                            <DialogTrigger asChild>
                              <Button 
                                variant="outline" 
                                size="sm"
                                onClick={() => setSelectedOwner(owner)}
                              >
                                Manage
                              </Button>
                            </DialogTrigger>
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle>Manage {owner.full_name}</DialogTitle>
                                <DialogDescription>
                                  Update subscription credit and deposit amount
                                </DialogDescription>
                              </DialogHeader>
                              
                              <div className="space-y-4">
                                <div>
                                  <Label htmlFor="credit">Add Credit (Days)</Label>
                                  <div className="flex gap-2 mt-2">
                                    <Select value={creditAmount.toString()} onValueChange={(val) => setCreditAmount(Number(val))}>
                                      <SelectTrigger>
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="30">1 Month (30 days)</SelectItem>
                                        <SelectItem value="60">2 Months (60 days)</SelectItem>
                                        <SelectItem value="90">3 Months (90 days)</SelectItem>
                                        <SelectItem value="180">6 Months (180 days)</SelectItem>
                                        <SelectItem value="365">1 Year (365 days)</SelectItem>
                                      </SelectContent>
                                    </Select>
                                    <Button onClick={() => addCredit(owner.id, creditAmount)}>
                                      Add Credit
                                    </Button>
                                  </div>
                                </div>

                                <div>
                                  <Label htmlFor="deposit">Update Deposit Amount</Label>
                                  <div className="flex gap-2 mt-2">
                                    <Input
                                      type="number"
                                      value={depositAmount}
                                      onChange={(e) => setDepositAmount(Number(e.target.value))}
                                      placeholder="Enter amount"
                                    />
                                    <Button onClick={() => updateDeposit(owner.id, depositAmount)}>
                                      Update
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            </DialogContent>
                          </Dialog>

                          <Button 
                            variant="destructive" 
                            size="sm"
                            onClick={() => deleteOwner(owner.id, owner.full_name)}
                          >
                            <Trash2 className="h-4 w-4 mr-1" />
                            Delete
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payments">
          <Card>
            <CardHeader>
              <CardTitle>Payment Requests</CardTitle>
              <CardDescription>Review and manage payment requests from pharmacy owners</CardDescription>
            </CardHeader>
            <CardContent>
              {paymentLoading ? (
                <div className="flex justify-center items-center h-32">
                  <Loader2 className="h-8 w-8 animate-spin" />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Owner</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Months</TableHead>
                      <TableHead>Payment Method</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paymentRequests.map((request) => (
                      <TableRow key={request.id}>
                        <TableCell className="font-medium">{request.pharmacy_owner_name}</TableCell>
                        <TableCell>${request.amount}</TableCell>
                        <TableCell>{request.months_requested}</TableCell>
                        <TableCell>{request.payment_method}</TableCell>
                        <TableCell>
                          {request.status === 'pending' && (
                            <Badge className="bg-yellow-100 text-yellow-800">Pending</Badge>
                          )}
                          {request.status === 'approved' && (
                            <Badge className="bg-green-100 text-green-800">Approved</Badge>
                          )}
                          {request.status === 'declined' && (
                            <Badge className="bg-red-100 text-red-800">Declined</Badge>
                          )}
                        </TableCell>
                        <TableCell>{new Date(request.created_at).toLocaleDateString()}</TableCell>
                        <TableCell>
                          {request.status === 'pending' && (
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                onClick={() => approvePayment(request.id, request.pharmacy_owner_id, request.months_requested)}
                              >
                                <CheckCircle className="h-4 w-4 mr-1" />
                                Approve
                              </Button>
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => declinePayment(request.id)}
                              >
                                <XCircle className="h-4 w-4 mr-1" />
                                Decline
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* System Actions */}
      <Card>
        <CardHeader>
          <CardTitle>System Actions</CardTitle>
          <CardDescription>Developer tools and system maintenance</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={triggerDailyDeduction} variant="outline">
            <AlertTriangle className="h-4 w-4 mr-2" />
            Trigger Daily Credit Deduction
          </Button>
        </CardContent>
      </Card>

      {/* Edit Owner Dialog */}
      <EditOwnerDialog 
        owner={editOwner}
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        onOwnerUpdated={fetchPharmacyOwners}
      />
    </div>
  );
}