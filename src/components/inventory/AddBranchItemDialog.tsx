import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Search, Loader2, Plus } from 'lucide-react';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { createBatch } from '@/lib/batchInventory';
import { useAuth } from '@/hooks/useAuth';
import { useBranchContext } from '@/hooks/useBranchContext';
import CreateCustomItemDialog from './CreateCustomItemDialog';

interface CatalogItem {
  id: string;
  name: string;
  generic_name?: string;
  category: string;
  manufacturer?: string;
  batch_number?: string;
  item_type?: string;
  unit_label?: string;
  units_per_pack?: number;
  minimum_stock_level?: number;
}

interface AddBranchItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onItemAdded: () => void;
}

export default function AddBranchItemDialog({ open, onOpenChange, onItemAdded }: AddBranchItemDialogProps) {
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedItem, setSelectedItem] = useState<CatalogItem | null>(null);
  const [showCustomDialog, setShowCustomDialog] = useState(false);
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string>('');
  const [suppliers, setSuppliers] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('');
  const [paymentType, setPaymentType] = useState<'paid' | 'credit'>('paid');
  const [recordInExpense, setRecordInExpense] = useState(true);

  // Form fields for branch-specific values
  const [sellingPrice, setSellingPrice] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [batchNumber, setBatchNumber] = useState('');

  const { toast } = useToast();
  const { profile } = useAuth();
  const { selectedBranch, branchType } = useBranchContext();
  const isPharmacy = branchType === 'pharmacy';

  useEffect(() => {
    if (open && profile) {
      fetchCatalogItems();
      fetchBranches();
      fetchSuppliers();
      resetForm();
    }
  }, [open, profile]);

  const resetForm = () => {
    setSelectedItem(null);
    setSearchTerm('');
    setSellingPrice('');
    setPurchasePrice('');
    setQuantity('');
    setExpiryDate('');
    setBatchNumber('');
    setSelectedSupplierId('');
    setPaymentType('paid');
    setRecordInExpense(true);
  };

  const fetchCatalogItems = async () => {
    if (!profile) return;
    setLoading(true);

    try {
      // Flow: owner → owner_item_groups → grouped_items → grouped_item_members → medicines
      const ownerId = profile.role === 'staff' ? null : profile.id;
      
      if (!ownerId) {
        setCatalogItems([]);
        setLoading(false);
        return;
      }

      // Step 1: Get groups assigned to this owner
      const { data: ownerGroups } = await supabase
        .from('owner_item_groups')
        .select('group_id')
        .eq('owner_id', ownerId);

      if (!ownerGroups || ownerGroups.length === 0) {
        setCatalogItems([]);
        setLoading(false);
        return;
      }

      const groupIds = ownerGroups.map((og: any) => og.group_id);

      // Step 2: Get medicine IDs from these groups
      const { data: groupMembers } = await supabase
        .from('grouped_item_members')
        .select('medicine_id')
        .in('group_id', groupIds);

      if (!groupMembers || groupMembers.length === 0) {
        setCatalogItems([]);
        setLoading(false);
        return;
      }

      const medicineIds = [...new Set(groupMembers.map((gm: any) => gm.medicine_id))];

      // Step 3: Fetch medicines
      const { data: meds } = await supabase
        .from('medicines')
        .select('id, name, generic_name, category, manufacturer, batch_number, item_type, unit_label, units_per_pack, minimum_stock_level')
        .in('id', medicineIds)
        .order('name');

      setCatalogItems(meds || []);
    } catch (error) {
      console.error('Error fetching catalog:', error);
      toast({ title: 'Error', description: 'Failed to load item catalog', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const fetchBranches = async () => {
    if (!profile || profile.role !== 'owner') return;
    const { data } = await supabase
      .from('pharmacy_branches')
      .select('id, name')
      .eq('pharmacy_owner_id', profile.id)
      .order('name');
    setBranches(data || []);
    if (selectedBranch) {
      setSelectedBranchId(selectedBranch);
    } else if (data && data.length > 0) {
      setSelectedBranchId(data[0].id);
    }
  };

  const fetchSuppliers = async () => {
    const { data } = await supabase.from('suppliers').select('id, name').order('name');
    setSuppliers(data || []);
  };

  const filteredItems = catalogItems.filter(item =>
    item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (item.generic_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.category.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSubmit = async () => {
    if (!selectedItem || !selectedBranchId || !sellingPrice || !purchasePrice || !quantity) {
      toast({ title: 'Error', description: 'Please fill all required fields', variant: 'destructive' });
      return;
    }

    setSubmitting(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      const sp = parseFloat(sellingPrice);
      const pp = parseFloat(purchasePrice);
      const qty = parseFloat(quantity);

      // Check if branch_item already exists for this medicine+branch
      const { data: existingBI } = await supabase
        .from('branch_items')
        .select('id, quantity')
        .eq('branch_id', selectedBranchId)
        .eq('medicine_id', selectedItem.id)
        .maybeSingle();

      let branchItemId: string;

      if (existingBI) {
        // Branch item exists — just add a new batch
        branchItemId = existingBI.id;
      } else {
        // Create new branch_item (quantity will be synced from batches)
        const { data: newBI, error } = await supabase.from('branch_items').insert({
          owner_id: profile?.id,
          branch_id: selectedBranchId,
          medicine_id: selectedItem.id,
          selling_price: sp,
          purchase_price: pp,
          quantity: qty,
          expiry_date: expiryDate || null,
        }).select('id').single();

        if (error) {
          if (error.code === '23505') {
            toast({ title: 'Error', description: 'This item already exists in this branch. Edit the existing entry instead.', variant: 'destructive' });
          } else {
            throw error;
          }
          setSubmitting(false);
          return;
        }
        branchItemId = newBI.id;
      }

      // Create inventory batch
      const { error: batchErr } = await createBatch({
        branchId: selectedBranchId,
        medicineId: selectedItem.id,
        branchItemId,
        supplierId: selectedSupplierId || null,
        batchNumber: batchNumber || null,
        quantity: qty,
        purchasePrice: pp,
        sellingPrice: sp,
        expiryDate: expiryDate || null,
        createdBy: user?.id || null,
      });

      if (batchErr) throw batchErr;

      const totalAmount = qty * pp;

      // Record supplier purchase if supplier is selected
      if (selectedSupplierId) {
        await supabase.from('supplier_purchases').insert({
          supplier_id: selectedSupplierId,
          item_name: selectedItem.name,
          quantity: qty,
          unit_cost: pp,
          total_cost: totalAmount,
          payment_type: paymentType,
          branch_id: selectedBranchId,
          created_by: user?.id || null,
        });

        if (paymentType === 'credit') {
          const { data: existingDebt } = await supabase
            .from('supplier_debts')
            .select('id, total_debt')
            .eq('supplier_id', selectedSupplierId)
            .maybeSingle();

          if (existingDebt) {
            await supabase.from('supplier_debts').update({ total_debt: existingDebt.total_debt + totalAmount }).eq('id', existingDebt.id);
          } else {
            await supabase.from('supplier_debts').insert({ supplier_id: selectedSupplierId, total_debt: totalAmount });
          }
        }
      }

      // Record expense
      if (recordInExpense && qty > 0 && pp > 0) {
        await supabase.from('expenses').insert({
          description: `Purchase of ${selectedItem.name} (${qty} units)${batchNumber ? ` [Batch: ${batchNumber}]` : ''}`,
          amount: totalAmount,
          category: 'Stock Purchase',
          created_by: user?.id || null,
          branch_id: selectedBranchId,
        });
      }

      toast({ title: 'Success', description: `${selectedItem.name} added to branch inventory (Batch created)` });
      onItemAdded();
      onOpenChange(false);
    } catch (error: any) {
      toast({ title: 'Error', description: error.message || 'Failed to add item', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Inventory Item</DialogTitle>
          <DialogDescription>
            Select an item from the catalog and configure branch-specific values
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Step 1: Search and select item */}
          {!selectedItem ? (
            <div className="space-y-3">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    placeholder="Search catalog items..."
                    className="pl-8"
                  />
                </div>
                <Button variant="outline" size="sm" className="shrink-0" onClick={() => setShowCustomDialog(true)}>
                  <Plus className="h-4 w-4 mr-1" /> Custom Item
                </Button>
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : filteredItems.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  {catalogItems.length === 0
                    ? 'No items available. Contact your administrator to assign item groups.'
                    : 'No items match your search.'}
                </div>
              ) : (
                <div className="max-h-64 overflow-y-auto border rounded-lg divide-y">
                  {filteredItems.map(item => (
                    <button
                      key={item.id}
                      onClick={() => setSelectedItem(item)}
                      className="w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors flex items-center justify-between"
                    >
                      <div>
                        <p className="font-medium text-sm">{item.name}</p>
                        {item.generic_name && (
                          <p className="text-xs text-muted-foreground">{item.generic_name}</p>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Badge variant="outline" className="text-xs">{item.category}</Badge>
                        {item.manufacturer && (
                          <Badge variant="secondary" className="text-xs">{item.manufacturer}</Badge>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Selected item info */}
              <div className="bg-muted/40 rounded-lg p-4 space-y-2">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-semibold">{selectedItem.name}</p>
                    {selectedItem.generic_name && (
                      <p className="text-sm text-muted-foreground">{selectedItem.generic_name}</p>
                    )}
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setSelectedItem(null)}>
                    Change
                  </Button>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Badge variant="outline">{selectedItem.category}</Badge>
                  {selectedItem.manufacturer && <Badge variant="secondary">{selectedItem.manufacturer}</Badge>}
                  {selectedItem.item_type && <Badge variant="secondary">{selectedItem.item_type}</Badge>}
                </div>
              </div>

              {/* Step 2: Branch-specific configuration */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {branches.length > 0 && (
                  <div className="space-y-2">
                    <Label>Branch *</Label>
                    <Select value={selectedBranchId} onValueChange={setSelectedBranchId}>
                      <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
                      <SelectContent>
                        {branches.map(b => (
                          <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="space-y-2">
                  <Label>Selling Price *</Label>
                  <Input type="number" step="0.01" min="0" value={sellingPrice} onChange={e => setSellingPrice(e.target.value)} placeholder="0.00" />
                </div>

                <div className="space-y-2">
                  <Label>Purchase Price (Cost) *</Label>
                  <Input type="number" step="0.01" min="0" value={purchasePrice} onChange={e => setPurchasePrice(e.target.value)} placeholder="0.00" />
                </div>

                <div className="space-y-2">
                  <Label>Quantity *</Label>
                  <Input
                    type="number"
                    step={selectedItem.item_type === 'measurable' ? '0.01' : '1'}
                    min="0"
                    value={quantity}
                    onChange={e => setQuantity(e.target.value)}
                    placeholder="0"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Batch Number</Label>
                  <Input value={batchNumber} onChange={e => setBatchNumber(e.target.value)} placeholder="e.g. BN-2026-001" />
                </div>

                <div className="space-y-2">
                  <Label>Expiry Date</Label>
                  <Input type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} />
                </div>
              </div>

              {/* Supplier (Optional) */}
              <div className="space-y-3 p-4 rounded-lg border bg-muted/30">
                <Label className="text-sm font-semibold">Link to Supplier (Optional)</Label>
                <Select value={selectedSupplierId || 'none'} onValueChange={val => setSelectedSupplierId(val === 'none' ? '' : val)}>
                  <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Supplier</SelectItem>
                    {suppliers.map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedSupplierId && (
                  <div className="space-y-2">
                    <Label className="text-sm">Payment Type</Label>
                    <Select value={paymentType} onValueChange={val => setPaymentType(val as 'paid' | 'credit')}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="paid">Paid</SelectItem>
                        <SelectItem value="credit">Credit (Debt)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              {/* Record in expense */}
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="record_expense"
                  checked={recordInExpense}
                  onCheckedChange={(checked) => setRecordInExpense(!!checked)}
                />
                <Label htmlFor="record_expense" className="text-sm cursor-pointer">
                  Record as expense (Stock Purchase)
                </Label>
              </div>

              <Button onClick={handleSubmit} disabled={submitting} className="w-full">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Add to Branch Inventory
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>

    <CreateCustomItemDialog
      open={showCustomDialog}
      onOpenChange={setShowCustomDialog}
      onItemCreated={(item) => {
        setCatalogItems(prev => [item as CatalogItem, ...prev]);
        setSelectedItem(item as CatalogItem);
      }}
    />
    </>
  );
}
