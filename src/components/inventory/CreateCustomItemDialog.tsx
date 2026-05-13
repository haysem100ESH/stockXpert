import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Plus } from 'lucide-react';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useBranchContext } from '@/hooks/useBranchContext';
import { useCustomCategories } from '@/hooks/useCustomCategories';
import { useMedicineGroups } from '@/hooks/useMedicineGroups';
import { MEASURABLE_UNIT_OPTIONS } from '@/lib/itemTypes';

interface CreateCustomItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onItemCreated: (item: { id: string; name: string; generic_name?: string; category: string; manufacturer?: string; item_type?: string; unit_label?: string; units_per_pack?: number; minimum_stock_level?: number }) => void;
}

export default function CreateCustomItemDialog({ open, onOpenChange, onItemCreated }: CreateCustomItemDialogProps) {
  const [name, setName] = useState('');
  const [genericName, setGenericName] = useState('');
  const [strength, setStrength] = useState('');
  const [medicineGroup, setMedicineGroup] = useState('');
  const [customGroup, setCustomGroup] = useState('');
  const [category, setCategory] = useState('');
  const [customCategory, setCustomCategory] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [itemType, setItemType] = useState<'full_pcs' | 'measurable'>('full_pcs');
  const [unitLabel, setUnitLabel] = useState('');
  const [packagingMode, setPackagingMode] = useState<'with_strip' | 'no_strip'>('no_strip');
  const [stripsPerPack, setStripsPerPack] = useState('');
  const [unitsPerStrip, setUnitsPerStrip] = useState('');
  const [unitsPack, setUnitsPack] = useState('');
  const [minStock, setMinStock] = useState('');
  // Multi-level packaging
  const [containerType, setContainerType] = useState(''); // packaging_mode column: Pack, Bottle, Box, Carton...
  const [mainUnitName, setMainUnitName] = useState('');
  const [unitName, setUnitName] = useState(''); // strip-level label (informational; persisted via unit_label too)
  const [subUnitsPerUnit, setSubUnitsPerUnit] = useState('');
  const [subUnitName, setSubUnitName] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [subUnitPrice, setSubUnitPrice] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const { toast } = useToast();
  const { profile } = useAuth();
  const { branchType } = useBranchContext();
  const isPharmacy = branchType === 'pharmacy';
  const { categories } = useCustomCategories(isPharmacy ? 'pharmacy' : 'general');
  const { groups: medicineGroups, addGroup } = useMedicineGroups();

  const resetForm = () => {
    setName('');
    setGenericName('');
    setStrength('');
    setMedicineGroup('');
    setCustomGroup('');
    setCategory('');
    setCustomCategory('');
    setManufacturer('');
    setItemType('full_pcs');
    setUnitLabel('');
    setPackagingMode('no_strip');
    setStripsPerPack('');
    setUnitsPerStrip('');
    setUnitsPack('');
    setMinStock('');
    setContainerType('');
    setMainUnitName('');
    setUnitName('');
    setSubUnitsPerUnit('');
    setSubUnitName('');
    setUnitPrice('');
    setSubUnitPrice('');
  };

  const handleCreate = async () => {
    const finalCategory = (category === '__custom__' ? customCategory.trim() : category) || 'Uncategorized';
    if (!name.trim()) {
      toast({ title: 'Error', description: 'Item name is required', variant: 'destructive' });
      return;
    }

    setSubmitting(true);
    try {
      let ownerId = profile?.id;

      // If staff, resolve owner via branch
      if (profile?.role === 'staff' && profile?.branch_id) {
        const { data: branch } = await supabase
          .from('pharmacy_branches')
          .select('pharmacy_owner_id')
          .eq('id', profile.branch_id)
          .single();
        ownerId = branch?.pharmacy_owner_id || undefined;
      }

      // Compute units_per_pack: if "with strip" → strips × units/strip, else manual input
      let computedUnitsPerPack: number | null = null;
      if (itemType === 'full_pcs' && packagingMode === 'with_strip') {
        const sp = parseInt(stripsPerPack);
        const ups = parseInt(unitsPerStrip);
        if (sp > 0 && ups > 0) {
          computedUnitsPerPack = sp * ups;
        }
      } else if (unitsPack) {
        computedUnitsPerPack = parseInt(unitsPack);
      }

      // Resolve final group: pharmacy mode only
      let finalGroup: string | null = null;
      if (isPharmacy) {
        if (medicineGroup === '__custom__') {
          const custom = customGroup.trim();
          if (custom) {
            await addGroup(custom);
            finalGroup = custom;
          }
        } else if (medicineGroup) {
          finalGroup = medicineGroup;
        }
      }

      // Insert into medicines table
      const insertPayload: any = {
        name: name.trim(),
        generic_name: genericName.trim() || null,
        category: finalCategory,
        manufacturer: manufacturer.trim() || null,
        item_type: itemType,
        unit_label: itemType === 'measurable' ? unitLabel : 'strip',
        units_per_pack: computedUnitsPerPack,
        minimum_stock_level: minStock ? parseInt(minStock) : null,
      };

      // Pharmacy-only fields
      if (isPharmacy) {
        insertPayload.strength = strength.trim() || null;
        insertPayload.medicine_group = finalGroup;
      }

      // Persist strip breakdown when applicable
      if (itemType === 'full_pcs' && packagingMode === 'with_strip') {
        insertPayload.strips_per_pack = parseInt(stripsPerPack);
        insertPayload.units_per_strip = parseInt(unitsPerStrip);
      }

      // Multi-level packaging fields (all optional, nullable)
      if (containerType.trim()) insertPayload.packaging_mode = containerType.trim();
      if (mainUnitName.trim()) insertPayload.main_unit_name = mainUnitName.trim();
      if (subUnitsPerUnit && parseInt(subUnitsPerUnit) > 0) {
        insertPayload.sub_units_per_unit = parseInt(subUnitsPerUnit);
        if (subUnitName.trim()) insertPayload.sub_unit_name = subUnitName.trim();
        if (subUnitPrice && !isNaN(parseFloat(subUnitPrice))) insertPayload.sub_unit_price = parseFloat(subUnitPrice);
      }
      if (unitPrice && !isNaN(parseFloat(unitPrice))) insertPayload.unit_price = parseFloat(unitPrice);

      const { data: newMed, error } = await supabase.from('medicines').insert(insertPayload).select('id, name, generic_name, category, manufacturer, item_type, unit_label, units_per_pack, minimum_stock_level').single();

      if (error) throw error;

      // Auto-link to owner's first group (or create one)
      if (ownerId) {
        const { data: ownerGroups } = await supabase
          .from('owner_item_groups')
          .select('group_id')
          .eq('owner_id', ownerId)
          .limit(1);

        let groupId: string;

        if (ownerGroups && ownerGroups.length > 0) {
          groupId = ownerGroups[0].group_id;
        } else {
          // Create a default group for this owner
          const { data: newGroup, error: groupErr } = await supabase
            .from('grouped_items')
            .insert({ group_name: 'Custom Items', business_type: branchType === 'pharmacy' ? 'pharmacy' : 'general' })
            .select('id')
            .single();

          if (groupErr) throw groupErr;
          groupId = newGroup.id;

          await supabase.from('owner_item_groups').insert({ owner_id: ownerId, group_id: groupId });
        }

        // Add medicine to group
        await supabase.from('grouped_item_members').insert({ group_id: groupId, medicine_id: newMed.id });
      }

      toast({ title: 'Success', description: `"${newMed.name}" created and added to your catalog` });
      onItemCreated(newMed);
      resetForm();
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error creating custom item:', error);
      toast({ title: 'Error', description: error.message || 'Failed to create item', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            Create Custom Item
          </DialogTitle>
          <DialogDescription>
            Add a new item to the catalog. It will be available in your inventory.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Item Name *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Paracetamol 500mg" />
          </div>

          <div className="space-y-2">
            <Label>Generic Name</Label>
            <Input value={genericName} onChange={e => setGenericName(e.target.value)} placeholder="e.g. Acetaminophen" />
          </div>

          {isPharmacy && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Strength</Label>
                  <Input value={strength} onChange={e => setStrength(e.target.value)} placeholder="e.g. 500mg, 250mg/5ml" />
                </div>
                <div className="space-y-2">
                  <Label>Medicine Group</Label>
                  <Select value={medicineGroup} onValueChange={setMedicineGroup}>
                    <SelectTrigger><SelectValue placeholder="Select group" /></SelectTrigger>
                    <SelectContent>
                      {medicineGroups.map(g => (
                        <SelectItem key={g.id} value={g.name}>{g.name}</SelectItem>
                      ))}
                      <SelectItem value="__custom__">+ Custom Group</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {medicineGroup === '__custom__' && (
                <Input value={customGroup} onChange={e => setCustomGroup(e.target.value)} placeholder="Enter new group name (e.g. NSAIDS and anti-pain)" />
              )}
            </>
          )}

          <div className="space-y-2">
            <Label>Category *</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
              <SelectContent>
                {categories.map(c => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
                <SelectItem value="__custom__">+ Custom Category</SelectItem>
              </SelectContent>
            </Select>
            {category === '__custom__' && (
              <Input value={customCategory} onChange={e => setCustomCategory(e.target.value)} placeholder="Enter custom category name" className="mt-2" />
            )}
          </div>

          <div className="space-y-2">
            <Label>Manufacturer</Label>
            <Input value={manufacturer} onChange={e => setManufacturer(e.target.value)} placeholder="e.g. GSK" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Item Type *</Label>
              <Select value={itemType} onValueChange={val => setItemType(val as 'full_pcs' | 'measurable')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="full_pcs">Countable (Pieces)</SelectItem>
                  <SelectItem value="measurable">Measurable (Kg, L, etc.)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {itemType === 'measurable' && (
              <div className="space-y-2">
                <Label>Unit</Label>
                <Select value={unitLabel} onValueChange={setUnitLabel}>
                  <SelectTrigger><SelectValue placeholder="Select unit" /></SelectTrigger>
                  <SelectContent>
                    {MEASURABLE_UNIT_OPTIONS.map(u => (
                      <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* Strip packaging — only for countable items */}
          {itemType === 'full_pcs' && (
            <div className="space-y-2">
              <Label>Packaging *</Label>
              <Select value={packagingMode} onValueChange={val => setPackagingMode(val as 'with_strip' | 'no_strip')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="no_strip">No strip (loose pieces)</SelectItem>
                  <SelectItem value="with_strip">With strip (e.g. tablets in blister)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {itemType === 'full_pcs' && packagingMode === 'with_strip' ? (
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
                <div className="text-xs text-muted-foreground -mt-2">
                  Total: {parseInt(stripsPerPack) * parseInt(unitsPerStrip)} units per pack
                </div>
              )}
              <div className="space-y-2">
                <Label>Minimum Stock Level</Label>
                <Input type="number" min="0" value={minStock} onChange={e => setMinStock(e.target.value)} placeholder="e.g. 5" />
              </div>
            </>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Units per Pack</Label>
                <Input type="number" min="1" value={unitsPack} onChange={e => setUnitsPack(e.target.value)} placeholder="e.g. 10" />
              </div>
              <div className="space-y-2">
                <Label>Minimum Stock Level</Label>
                <Input type="number" min="0" value={minStock} onChange={e => setMinStock(e.target.value)} placeholder="e.g. 5" />
              </div>
            </div>
          )}

          {/* Container / packaging type (free-text with suggestions) */}
          <div className="space-y-2">
            <Label>Container Type</Label>
            <Input
              list="container-types"
              value={containerType}
              onChange={e => setContainerType(e.target.value)}
              placeholder="e.g. Pack, Bottle, Box, Carton, Sachet, Tube, Roll, Bag"
            />
            <datalist id="container-types">
              {['Pack','Bottle','Box','Carton','Sachet','Tube','Roll','Bag','Container','Vial','Ampoule'].map(o => (
                <option key={o} value={o} />
              ))}
            </datalist>
          </div>

          {/* Sub-unit (3rd hierarchy level) — only meaningful for countable items */}
          {itemType === 'full_pcs' && (
            <div className="space-y-3 rounded-lg border p-3 bg-muted/20">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold">Sub-unit (optional)</Label>
                <span className="text-xs text-muted-foreground">e.g. tablets in a strip</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Sub-units per Unit</Label>
                  <Input type="number" min="0" value={subUnitsPerUnit} onChange={e => setSubUnitsPerUnit(e.target.value)} placeholder="e.g. 5" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Sub-unit Name</Label>
                  <Input value={subUnitName} onChange={e => setSubUnitName(e.target.value)} placeholder="e.g. Tablet, Piece" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Unit / Strip Price</Label>
                  <Input type="number" step="0.01" min="0" value={unitPrice} onChange={e => setUnitPrice(e.target.value)} placeholder="Optional" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Sub-unit Price</Label>
                  <Input type="number" step="0.01" min="0" value={subUnitPrice} onChange={e => setSubUnitPrice(e.target.value)} placeholder="Optional" />
                </div>
              </div>
            </div>
          )}

          <Button onClick={handleCreate} disabled={submitting} className="w-full">
            {submitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Create Item
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
