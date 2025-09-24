import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CreditCard, Users, Building2, DollarSign } from 'lucide-react';

interface PharmacyOwner {
  id: string;
  full_name: string;
  email: string;
  subscription: {
    subscription_credit: number;
    status: 'active' | 'expiring_soon' | 'expired';
    deposit_amount: number;
  } | null;
  branch_count: number;
  pending_payments: number;
}

export default function DeveloperDashboard() {
  const [owners, setOwners] = useState<PharmacyOwner[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOwner, setSelectedOwner] = useState<PharmacyOwner | null>(null);
  const [creditAmount, setCreditAmount] = useState<number>(30);
  const [depositAmount, setDepositAmount] = useState<number>(0);
  const { toast } = useToast();

  useEffect(() => {
    fetchPharmacyOwners();
  }, []);

  const fetchPharmacyOwners = async () => {
    try {
      setLoading(true);
      
      // Get all pharmacy owners with their subscriptions and branch counts
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select(`
          id,
          full_name,
          pharmacy_subscriptions (
            subscription_credit,
            status,
            deposit_amount
          ),
          pharmacy_branches (count)
        `)
        .eq('role', 'owner');

      if (profilesError) throw profilesError;

      // Get user emails from auth (this requires service role but we'll handle it)
      const ownerData: PharmacyOwner[] = await Promise.all(
        profiles.map(async (profile: any) => {
          // Get pending payment requests count
          const { count: pendingCount } = await supabase
            .from('payment_requests')
            .select('*', { count: 'exact', head: true })
            .eq('pharmacy_owner_id', profile.id)
            .eq('status', 'pending');

          return {
            id: profile.id,
            full_name: profile.full_name,
            email: 'Contact support for email', // We can't access auth.users directly
            subscription: profile.pharmacy_subscriptions?.[0] || null,
            branch_count: profile.pharmacy_branches?.[0]?.count || 0,
            pending_payments: pendingCount || 0
          };
        })
      );

      setOwners(ownerData);
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

  const addCredit = async (ownerId: string, days: number) => {
    try {
      // Get current subscription first
      const { data: currentSub } = await supabase
        .from('pharmacy_subscriptions')
        .select('subscription_credit')
        .eq('pharmacy_owner_id', ownerId)
        .single();

      const newCredit = (currentSub?.subscription_credit || 0) + days;

      const { error } = await supabase
        .from('pharmacy_subscriptions')
        .upsert({
          pharmacy_owner_id: ownerId,
          subscription_credit: newCredit,
          status: 'active'
        }, {
          onConflict: 'pharmacy_owner_id'
        });

      if (error) throw error;

      toast({
        title: "Success",
        description: `Added ${days} days credit successfully`
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

      fetchPharmacyOwners();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    }
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
        <Button onClick={fetchPharmacyOwners}>Refresh Data</Button>
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
            <Building2 className="h-4 w-4 text-muted-foreground" />
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

      {/* Pharmacy Owners Table */}
      <Card>
        <CardHeader>
          <CardTitle>Pharmacy Owners</CardTitle>
          <CardDescription>Manage subscriptions and view details</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Owner Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Credit (Days)</TableHead>
                <TableHead>Branches</TableHead>
                <TableHead>Deposit</TableHead>
                <TableHead>Pending Payments</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {owners.map((owner) => (
                <TableRow key={owner.id}>
                  <TableCell className="font-medium">{owner.full_name}</TableCell>
                  <TableCell>{getStatusBadge(owner.subscription?.status || null)}</TableCell>
                  <TableCell>{owner.subscription?.subscription_credit || 0}</TableCell>
                  <TableCell>{owner.branch_count}</TableCell>
                  <TableCell>${owner.subscription?.deposit_amount || 0}</TableCell>
                  <TableCell>
                    {owner.pending_payments > 0 && (
                      <Badge variant="outline">{owner.pending_payments}</Badge>
                    )}
                  </TableCell>
                  <TableCell>
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
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}