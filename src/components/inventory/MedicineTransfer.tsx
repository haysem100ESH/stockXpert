import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { ArrowRight, Package } from 'lucide-react';

interface Branch {
  id: string;
  name: string;
  address: string;
}

interface Medicine {
  id: string;
  name: string;
  stock_quantity: number;
  generic_name?: string;
}

interface Transfer {
  id: string;
  medicine_id: string;
  from_branch_id: string;
  to_branch_id: string;
  quantity: number;
  transferred_by: string;
  created_at: string;
  notes?: string;
  medicines: {
    name: string;
  };
  from_branch: {
    name: string;
  };
  to_branch: {
    name: string;
  };
  transferrer: {
    full_name: string;
    email: string;
  };
}

export default function MedicineTransfer() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [fromBranch, setFromBranch] = useState<string>('');
  const [toBranch, setToBranch] = useState<string>('');
  const [selectedMedicine, setSelectedMedicine] = useState<string>('');
  const [quantity, setQuantity] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const { profile, user } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    fetchBranches();
    fetchTransferHistory();
  }, [profile]);

  useEffect(() => {
    if (fromBranch) {
      fetchMedicines(fromBranch);
    } else {
      setMedicines([]);
    }
  }, [fromBranch]);

  const fetchBranches = async () => {
    try {
      let query = supabase.from('pharmacy_branches').select('id, name, address');

      if (profile?.role === 'owner') {
        query = query.eq('pharmacy_owner_id', profile.id);
      } else if (profile?.role === 'staff') {
        // Staff can see all branches under their owner
        const { data: staffBranch } = await supabase
          .from('pharmacy_branches')
          .select('pharmacy_owner_id')
          .eq('id', profile.branch_id)
          .single();

        if (staffBranch) {
          query = query.eq('pharmacy_owner_id', staffBranch.pharmacy_owner_id);
        }
      }

      const { data, error } = await query.order('name');

      if (error) throw error;
      setBranches(data || []);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to fetch branches',
        variant: 'destructive',
      });
    }
  };

  // Filter branches for "From" dropdown based on user role
  const getFromBranchOptions = () => {
    if (profile?.role === 'staff') {
      // Staff can only transfer FROM their assigned branch
      return branches.filter((branch) => branch.id === profile.branch_id);
    }
    return branches;
  };

  // Filter branches for "To" dropdown
  const getToBranchOptions = () => {
    if (profile?.role === 'staff') {
      // Staff can transfer TO any branch except their own
      return branches.filter((branch) => branch.id !== profile.branch_id);
    }
    // Owners can transfer to any branch except the selected "from" branch
    return branches.filter((branch) => branch.id !== fromBranch);
  };

  const fetchMedicines = async (branchId: string) => {
    try {
      const { data, error } = await supabase
        .from('medicines')
        .select('id, name, stock_quantity, generic_name')
        .eq('branch_id', branchId)
        .gt('stock_quantity', 0)
        .order('name');

      if (error) throw error;
      setMedicines(data || []);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to fetch medicines',
        variant: 'destructive',
      });
    }
  };

  const fetchTransferHistory = async () => {
    try {
      const { data, error } = await supabase
        .from('medicine_transfers')
        .select(`
          *,
          medicines (name),
          from_branch:pharmacy_branches!medicine_transfers_from_branch_id_fkey (name),
          to_branch:pharmacy_branches!medicine_transfers_to_branch_id_fkey (name)
        `)
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) throw error;

      // Fetch transferrer information
      const transfersWithUser = await Promise.all(
        (data || []).map(async (transfer: any) => {
          const { data: userData } = await supabase
            .from('profiles')
            .select('full_name, email')
            .eq('id', transfer.transferred_by)
            .single();

          return {
            ...transfer,
            transferrer: userData,
          };
        })
      );

      setTransfers(transfersWithUser);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to fetch transfer history',
        variant: 'destructive',
      });
    }
  };

  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!fromBranch || !toBranch || !selectedMedicine || !quantity || !user) {
      toast({
        title: 'Error',
        description: 'Please fill in all required fields',
        variant: 'destructive',
      });
      return;
    }

    if (fromBranch === toBranch) {
      toast({
        title: 'Error',
        description: 'Source and destination branches must be different',
        variant: 'destructive',
      });
      return;
    }

    const transferQty = parseInt(quantity);
    const selectedMed = medicines.find((m) => m.id === selectedMedicine);

    if (!selectedMed || transferQty > selectedMed.stock_quantity) {
      toast({
        title: 'Error',
        description: 'Insufficient stock in source branch',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);

    try {
      // Start a transaction by doing all operations
      // 1. Record the transfer
      const { error: transferError } = await supabase
        .from('medicine_transfers')
        .insert({
          medicine_id: selectedMedicine,
          from_branch_id: fromBranch,
          to_branch_id: toBranch,
          quantity: transferQty,
          transferred_by: user.id,
          notes: notes || null,
        });

      if (transferError) throw transferError;

      // 2. Deduct from source branch
      const { error: deductError } = await supabase
        .from('medicines')
        .update({ stock_quantity: selectedMed.stock_quantity - transferQty })
        .eq('id', selectedMedicine)
        .eq('branch_id', fromBranch);

      if (deductError) throw deductError;

      // 3. Check if medicine exists in destination branch
      const { data: destMedicine, error: checkError } = await supabase
        .from('medicines')
        .select('id, stock_quantity')
        .eq('name', selectedMed.name)
        .eq('branch_id', toBranch)
        .maybeSingle();

      if (checkError) throw checkError;

      if (destMedicine) {
        // Update existing medicine in destination
        const { error: updateError } = await supabase
          .from('medicines')
          .update({ stock_quantity: destMedicine.stock_quantity + transferQty })
          .eq('id', destMedicine.id);

        if (updateError) throw updateError;
      } else {
        // Create new medicine record in destination branch with all details
        const { data: sourceMedDetails } = await supabase
          .from('medicines')
          .select('*')
          .eq('id', selectedMedicine)
          .single();

        if (sourceMedDetails) {
          const { error: insertError } = await supabase
            .from('medicines')
            .insert({
              name: sourceMedDetails.name,
              generic_name: sourceMedDetails.generic_name,
              manufacturer: sourceMedDetails.manufacturer,
              batch_number: sourceMedDetails.batch_number,
              country_name: sourceMedDetails.country_name,
              category: sourceMedDetails.category,
              purchase_price: sourceMedDetails.purchase_price,
              selling_price: sourceMedDetails.selling_price,
              expiry_date: sourceMedDetails.expiry_date,
              minimum_stock_level: sourceMedDetails.minimum_stock_level,
              expiry_alert_enabled: sourceMedDetails.expiry_alert_enabled,
              supplier_id: sourceMedDetails.supplier_id,
              branch_id: toBranch,
              stock_quantity: transferQty,
              created_by: user.id,
            });

          if (insertError) throw insertError;
        }
      }

      toast({
        title: 'Success',
        description: 'Medicine transferred successfully',
      });

      // Reset form
      setFromBranch('');
      setToBranch('');
      setSelectedMedicine('');
      setQuantity('');
      setNotes('');
      setMedicines([]);

      // Refresh data
      fetchTransferHistory();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to transfer medicine',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Transfer Medicine Between Branches</CardTitle>
          <CardDescription>Move medicine inventory from one branch to another</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleTransfer} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="fromBranch">From Branch *</Label>
                <Select value={fromBranch} onValueChange={setFromBranch}>
                  <SelectTrigger id="fromBranch">
                    <SelectValue placeholder="Select source branch" />
                  </SelectTrigger>
                  <SelectContent>
                    {getFromBranchOptions().map((branch) => (
                      <SelectItem key={branch.id} value={branch.id}>
                        {branch.name}
                        {profile?.role === 'staff' && branch.id === profile.branch_id && ' (Your Branch)'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="toBranch">To Branch *</Label>
                <Select value={toBranch} onValueChange={setToBranch}>
                  <SelectTrigger id="toBranch">
                    <SelectValue placeholder="Select destination branch" />
                  </SelectTrigger>
                  <SelectContent>
                    {getToBranchOptions().map((branch) => (
                      <SelectItem key={branch.id} value={branch.id}>
                        {branch.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="medicine">Medicine *</Label>
              <Select
                value={selectedMedicine}
                onValueChange={setSelectedMedicine}
                disabled={!fromBranch}
              >
                <SelectTrigger id="medicine">
                  <SelectValue placeholder="Search and select medicine to transfer" />
                </SelectTrigger>
                <SelectContent>
                  {medicines.length === 0 ? (
                    <div className="p-2 text-sm text-muted-foreground">
                      No medicines available in selected branch
                    </div>
                  ) : (
                    medicines.map((medicine) => (
                      <SelectItem key={medicine.id} value={medicine.id}>
                        {medicine.name} {medicine.generic_name && `(${medicine.generic_name})`}
                        <span className="ml-2 text-muted-foreground">
                          • Stock: {medicine.stock_quantity}
                        </span>
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="quantity">Quantity *</Label>
              <Input
                id="quantity"
                type="number"
                min="1"
                max={medicines.find((m) => m.id === selectedMedicine)?.stock_quantity || 0}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="Enter quantity to transfer"
                disabled={!selectedMedicine}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes (Optional)</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add any notes about this transfer"
                rows={3}
              />
            </div>

            <Button type="submit" disabled={loading} className="w-full">
              <ArrowRight className="mr-2 h-4 w-4" />
              {loading ? 'Transferring...' : 'Transfer Medicine'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent Transfers</CardTitle>
          <CardDescription>Latest medicine transfer history</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {transfers.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Package className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p>No transfer history yet</p>
              </div>
            ) : (
              transfers.map((transfer) => (
                <div key={transfer.id} className="p-4 border rounded-lg space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="font-medium">{transfer.medicines.name}</div>
                    <div className="text-sm font-semibold">Qty: {transfer.quantity}</div>
                  </div>
                  <div className="flex items-center text-sm text-muted-foreground">
                    <span>{transfer.from_branch.name}</span>
                    <ArrowRight className="mx-2 h-4 w-4" />
                    <span>{transfer.to_branch.name}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <div>
                      Transferred by: {transfer.transferrer?.full_name || transfer.transferrer?.email}
                    </div>
                    <div>{new Date(transfer.created_at).toLocaleString()}</div>
                    {transfer.notes && <div className="mt-1 italic">Note: {transfer.notes}</div>}
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
