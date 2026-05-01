import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useBranchContext } from '@/hooks/useBranchContext';
import { useCustomCategories } from '@/hooks/useCustomCategories';
import { useMedicineGroups } from '@/hooks/useMedicineGroups';

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
  strips_per_pack?: number;
  units_per_strip?: number;
  medicine_group?: string | null;
  strength?: string | null;
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
  const [strength, setStrength] = useState('');
  const [medicineGroup, setMedicineGroup] = useState('');
  const [customGroup, setCustomGroup] = useState('');

  // Strip packaging
  const [packagingMode, setPackagingMode] = useState<'with_strip' | 'no_strip'>('no_strip');
  const [stripsPerPack, setStripsPerPack] = useState('');
  const [unitsPerStrip, setUnitsPerStrip] = useState('');
  const [unitsPerPack, setUnitsPerPack] = useState('');

  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const { profile } = useAuth();
  const { branchType } = useBranchContext();
  const isPharmacy = branchType === 'pharmacy';
  const { categories: customCategories } = useCustomCategories(branchType === 'general' ? 'general' : 'pharmacy');
  const { groups: medicineGroups, addGroup } = useMedicineGroups();

  // Build dropdown list: include current value if not in custom list so user never loses the existing category
  const categoryOptions = (() => {
    const set = new Set<string>(customCategories);
    if (category && category.trim()) set.add(category.trim());
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  })();

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
      setStrength(item.strength || '');
      setMedicineGroup(item.medicine_group || '');
      setCustomGroup('');

      const hasStrip = !!(item.strips_per_pack && item.units_per_strip);
      setPackagingMode(hasStrip ? 'with_strip' : 'no_strip');
      setStripsPerPack(hasStrip ? String(item.strips_per_pack) : '');
      setUnitsPerStrip(hasStrip ? String(item.units_per_strip) : '');
      setUnitsPerPack(item.units_per_pack ? String(item.units_per_pack) : '');
    }
  }, [item, open]);

  const computeUnitsPerPack = (): number | null => {
    if (packagingMode === 'with_strip') {
      const sp = parseInt(stripsPerPack);
      const ups = parseInt(unitsPerStrip);
      if (sp > 0 && ups > 0) return sp * ups;
      return null;
    }
    return unitsPerPack ? parseInt(unitsPerPack) : null;
  };

  const catalogFieldsChanged = () => {
    if (!item) return false;
    const newUpp = computeUnitsPerPack();
    const oldStripsPerPack = item.strips_per_pack || null;
    const oldUnitsPerStrip = item.units_per_strip || null;
    const newStripsPerPack = packagingMode === 'with_strip' && stripsPerPack ? parseInt(stripsPerPack) : null;
    const newUnitsPerStrip = packagingMode === 'with_strip' && unitsPerStrip ? parseInt(unitsPerStrip) : null;
    return (
      itemName !== (item.name || '') ||
      genericName !== (item.generic_name || '') ||
      category !== (item.category || '') ||
      manufacturer !== (item.manufacturer || '') ||
      batchNumber !== (item.batch_number || '') ||
      unitLabel !== (item.unit_label || '') ||
      newUpp !== (item.units_per_pack || null) ||
      newStripsPerPack !== oldStripsPerPack ||
      newUnitsPerStrip !== oldUnitsPerStrip
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!item) return;

    if (packagingMode === 'with_strip') {
      const sp = parseInt(stripsPerPack);
      const ups = parseInt(unitsPerStrip);
      if (!sp || !ups || sp < 1 || ups < 1) {
        toast({ title: 'Error', description: 'Strips per item and total items are required for strip packaging', variant: 'destructive' });
        return;
      }
    }

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
          units_per_pack: computeUnitsPerPack(),
          strips_per_pack: packagingMode === 'with_strip' ? parseInt(stripsPerPack) : null,
          units_per_strip: packagingMode === 'with_strip' ? parseInt(unitsPerStrip) : null,
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

      // Log every changed field to stock_edit_history
      try {
        const changes: Array<{ field: string; oldVal: any; newVal: any }> = [];
        if (parseFloat(sellingPrice) !== Number(item.selling_price)) {
          changes.push({ field: 'selling_price', oldVal: item.selling_price, newVal: parseFloat(sellingPrice) });
        }
        if (parseFloat(purchasePrice) !== Number(item.purchase_price)) {
          changes.push({ field: 'purchase_price', oldVal: item.purchase_price, newVal: parseFloat(purchasePrice) });
        }
        if ((expiryDate || null) !== (item.expiry_date || null)) {
          changes.push({ field: 'expiry_date', oldVal: item.expiry_date || '—', newVal: expiryDate || '—' });
        }
        if (itemName !== (item.name || '')) changes.push({ field: 'name', oldVal: item.name, newVal: itemName });
        if (genericName !== (item.generic_name || '')) changes.push({ field: 'generic_name', oldVal: item.generic_name || '—', newVal: genericName || '—' });
        if (category !== (item.category || '')) changes.push({ field: 'category', oldVal: item.category, newVal: category });
        if (manufacturer !== (item.manufacturer || '')) changes.push({ field: 'manufacturer', oldVal: item.manufacturer || '—', newVal: manufacturer || '—' });
        if (batchNumber !== (item.batch_number || '')) changes.push({ field: 'batch_number', oldVal: item.batch_number || '—', newVal: batchNumber || '—' });
        if (unitLabel !== (item.unit_label || '')) changes.push({ field: 'unit_label', oldVal: item.unit_label || '—', newVal: unitLabel || '—' });

        if (changes.length > 0) {
          const rows = changes.map(c => ({
            medicine_id: item.medicine_id,
            branch_id: item.branch_id || null,
            action_type: 'Item Modified',
            field_name: c.field,
            old_value: String(c.oldVal ?? ''),
            new_value: String(c.newVal ?? ''),
            reason: 'Edited via Edit Item dialog',
            done_by: profile?.id || null,
            done_by_name: profile?.full_name || 'Unknown',
            item_name: itemName || item.name,
          }));
          await (supabase as any).from('stock_edit_history').insert(rows);
        }
      } catch (logErr) {
        console.warn('Failed to log edit history:', logErr);
      }

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
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a category" />
                    </SelectTrigger>
                    <SelectContent className="max-h-60">
                      {categoryOptions.length === 0 ? (
                        <div className="px-2 py-1.5 text-sm text-muted-foreground">
                          No categories yet. Create some in the Categories page.
                        </div>
                      ) : (
                        categoryOptions.map(c => (
                          <SelectItem key={c} value={c}>{c}</SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
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

              {/* Packaging mode */}
              <div className="space-y-2">
                <Label>Packaging *</Label>
                <Select value={packagingMode} onValueChange={(val) => setPackagingMode(val as 'with_strip' | 'no_strip')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="no_strip">No strip (loose pieces)</SelectItem>
                    <SelectItem value="with_strip">With strip (e.g. tablets in blister)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {packagingMode === 'with_strip' ? (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Strips per Item *</Label>
                      <Input type="number" min="1" value={stripsPerPack} onChange={e => setStripsPerPack(e.target.value)} placeholder="e.g. 10" />
                    </div>
                    <div className="space-y-2">
                      <Label>Total Items *</Label>
                      <Input type="number" min="1" value={unitsPerStrip} onChange={e => setUnitsPerStrip(e.target.value)} placeholder="e.g. 10" />
                    </div>
                  </div>
                  {stripsPerPack && unitsPerStrip && parseInt(stripsPerPack) > 0 && parseInt(unitsPerStrip) > 0 && (
                    <p className="text-xs text-muted-foreground -mt-2">
                      Total: {parseInt(stripsPerPack) * parseInt(unitsPerStrip)} units per pack
                    </p>
                  )}
                </>
              ) : (
                <div className="space-y-2">
                  <Label>Units per Pack</Label>
                  <Input type="number" min="1" value={unitsPerPack} onChange={e => setUnitsPerPack(e.target.value)} placeholder="Leave empty if not sold by unit" />
                </div>
              )}

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
