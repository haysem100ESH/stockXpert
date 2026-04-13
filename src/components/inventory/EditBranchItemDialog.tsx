import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';

export interface BranchItem {
  id: string;
  medicine_id: string;
  branch_id: string;
  owner_id: string;
  selling_price: number;
  purchase_price: number;
  quantity: number;
  expiry_date?: string | null;
  // Joined from medicines
  name: string;
  generic_name?: string;
  category: string;
  manufacturer?: string;
  batch_number?: string;
  item_type?: string;
  unit_label?: string;
  units_per_pack?: number;
}

interface EditBranchItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: BranchItem | null;
  onItemUpdated: () => void;
}

export default function EditBranchItemDialog({ open, onOpenChange, item, onItemUpdated }: EditBranchItemDialogProps) {
  // Branch-specific fields
  const [sellingPrice, setSellingPrice] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [expiryDate, setExpiryDate] = useState('');

  // Catalog fields (editable)
  const [itemName, setItemName] = useState('');
  const [genericName, setGenericName] = useState('');
  const [category, setCategory] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [batchNumber, setBatchNumber] = useState('');
  const [unitLabel, setUnitLabel] = useState('');

  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const { profile } = useAuth();

  useEffect(() => {
    if (item && open) {
      setSellingPrice(item.selling_price.toString());
      setPurchasePrice(item.purchase_price.toString());
      setExpiryDate(item.expiry_date || '');
      setItemName(item.name || '');
      setGenericName(item.generic_name || '');
      setCategory(item.category || '');
      setManufacturer(item.manufacturer || '');
      setBatchNumber(item.batch_number || '');
      setUnitLabel(item.unit_label || '');
    }
  }, [item, open]);

  const catalogFieldsChanged = () => {
    if (!item) return false;
    return (
      itemName !== (item.name || '') ||
      genericName !== (item.generic_name || '') ||
      category !== (item.category || '') ||
      manufacturer !== (item.manufacturer || '') ||
      batchNumber !== (item.batch_number || '') ||
      unitLabel !== (item.unit_label || '')
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!item) return;
    setLoading(true);

    try {
      // Always update branch-specific fields
      const branchUpdate: any = {
        selling_price: parseFloat(sellingPrice),
        purchase_price: parseFloat(purchasePrice),
        expiry_date: expiryDate || null,
        updated_at: new Date().toISOString(),
      };

      // If catalog fields changed, we need clone-on-write
      if (catalogFieldsChanged()) {
        const newMedicineData = {
          name: itemName.trim(),
          generic_name: genericName.trim() || null,
          category: category.trim(),
          manufacturer: manufacturer.trim() || null,
          batch_number: batchNumber.trim() || null,
          unit_label: unitLabel.trim() || null,
        };

        // Check if other owners also reference this medicine
        const { data: otherBranchItems } = await supabase
          .from('branch_items')
          .select('id, owner_id')
          .eq('medicine_id', item.medicine_id)
          .neq('owner_id', item.owner_id);

        const isShared = (otherBranchItems || []).length > 0;

        if (isShared) {
          // Clone: create a new medicine row for this owner
          // First get full original medicine data
          const { data: origMed } = await supabase
            .from('medicines')
            .select('*')
            .eq('id', item.medicine_id)
            .single();

          if (!origMed) throw new Error('Original medicine not found');

          // Create cloned medicine with updated fields
          const { id: _id, created_at: _ca, ...restMed } = origMed;
          const { data: clonedMed, error: cloneErr } = await supabase
            .from('medicines')
            .insert({ ...restMed, ...newMedicineData })
            .select('id')
            .single();

          if (cloneErr) throw cloneErr;

          const newMedicineId = clonedMed.id;

          // Update all this owner's branch_items that reference the old medicine to point to the clone
          await supabase
            .from('branch_items')
            .update({ medicine_id: newMedicineId })
            .eq('medicine_id', item.medicine_id)
            .eq('owner_id', item.owner_id);

          // Update inventory_batches for this owner's branch_items
          // Get this owner's branch_item IDs for the old medicine
          const { data: ownerItems } = await supabase
            .from('branch_items')
            .select('id')
            .eq('medicine_id', newMedicineId)
            .eq('owner_id', item.owner_id);

          // Update grouped_items: add clone to owner's groups, remove old
          const ownerId = item.owner_id;
          const { data: ownerGroups } = await supabase
            .from('owner_item_groups')
            .select('group_id')
            .eq('owner_id', ownerId);

          if (ownerGroups && ownerGroups.length > 0) {
            const groupIds = ownerGroups.map((g: any) => g.group_id);

            // Find which groups had the old medicine
            const { data: oldGroupedItems } = await supabase
              .from('grouped_items')
              .select('id, group_id')
              .eq('medicine_id', item.medicine_id)
              .in('group_id', groupIds);

            if (oldGroupedItems && oldGroupedItems.length > 0) {
              // Add clone to same groups
              for (const gi of oldGroupedItems) {
                await supabase
                  .from('grouped_items')
                  .insert({ group_id: gi.group_id, medicine_id: newMedicineId });
              }
              // Remove old medicine from owner's groups
              const oldIds = oldGroupedItems.map((gi: any) => gi.id);
              await supabase
                .from('grouped_items')
                .delete()
                .in('id', oldIds);
            }
          }
        } else {
          // Not shared - safe to edit the medicine directly
          const { error: medErr } = await supabase
            .from('medicines')
            .update(newMedicineData)
            .eq('id', item.medicine_id);

          if (medErr) throw medErr;
        }
      }

      // Update branch item pricing/expiry
      const { error } = await supabase
        .from('branch_items')
        .update(branchUpdate)
        .eq('id', item.id);

      if (error) throw error;

      toast({ title: 'Success', description: 'Item updated successfully' });
      onItemUpdated();
      onOpenChange(false);
    } catch (error: any) {
      toast({ title: 'Error', description: error.message || 'Failed to update item', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Edit Item</DialogTitle>
          <DialogDescription>
            Update item details. Changes to item info won't affect other users' items.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Tabs defaultValue="branch" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="branch">Pricing & Stock</TabsTrigger>
              <TabsTrigger value="catalog">Item Info</TabsTrigger>
            </TabsList>

            <TabsContent value="branch" className="space-y-4 mt-4">
              {/* Read-only stock info */}
              <div className="bg-muted/40 rounded-lg p-3 space-y-1">
                <p className="font-semibold">{item.name}</p>
                <div className="flex gap-2 flex-wrap">
                  <Badge variant="outline">{item.category}</Badge>
                  {item.item_type && <Badge variant="secondary">{item.item_type}</Badge>}
                </div>
                <div className="text-sm text-muted-foreground">
                  Current Stock: <span className="font-medium text-foreground">{item.quantity}</span>
                  {item.unit_label && ` ${item.unit_label}`}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Selling Price *</Label>
                  <Input type="number" step="0.01" min="0" value={sellingPrice} onChange={e => setSellingPrice(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label>Purchase Price *</Label>
                  <Input type="number" step="0.01" min="0" value={purchasePrice} onChange={e => setPurchasePrice(e.target.value)} required />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Expiry Date</Label>
                <Input type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} />
              </div>
            </TabsContent>

            <TabsContent value="catalog" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>Item Name *</Label>
                <Input value={itemName} onChange={e => setItemName(e.target.value)} required />
              </div>

              <div className="space-y-2">
                <Label>Generic Name</Label>
                <Input value={genericName} onChange={e => setGenericName(e.target.value)} placeholder="Optional" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Category *</Label>
                  <Input value={category} onChange={e => setCategory(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label>Manufacturer / Brand</Label>
                  <Input value={manufacturer} onChange={e => setManufacturer(e.target.value)} placeholder="Optional" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Batch Number</Label>
                  <Input value={batchNumber} onChange={e => setBatchNumber(e.target.value)} placeholder="Optional" />
                </div>
                <div className="space-y-2">
                  <Label>Unit Label</Label>
                  <Input value={unitLabel} onChange={e => setUnitLabel(e.target.value)} placeholder="e.g. tablets, ml" />
                </div>
              </div>

              {catalogFieldsChanged() && (
                <p className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
                  ℹ️ Item info changes are scoped to your account only and won't affect other users.
                </p>
              )}
            </TabsContent>
          </Tabs>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Save Changes
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
