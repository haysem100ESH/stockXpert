import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { useBranchContext } from '@/hooks/useBranchContext';
import { useCustomCategories } from '@/hooks/useCustomCategories';
import { useMedicineGroups } from '@/hooks/useMedicineGroups';
import { MEASURABLE_UNIT_OPTIONS } from '@/lib/itemTypes';

interface Medicine {
  id: string;
  name: string;
  generic_name?: string;
  category: string;
  manufacturer?: string;
  batch_number?: string;
  country_name?: string;
  purchase_price: number;
  selling_price: number;
  stock_quantity: number;
  minimum_stock_level: number;
  expiry_date?: string;
  expiry_alert_enabled?: boolean;
  medicine_group?: string | null;
  strength?: string | null;
}

interface EditMedicineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  medicine: Medicine | null;
  onMedicineUpdated: () => void;
}

interface MedicineWithBranch extends Medicine {
  branch_id?: string;
}

export default function EditMedicineDialog({
  open,
  onOpenChange,
  medicine,
  onMedicineUpdated
}: EditMedicineDialogProps) {
  const { branchType } = useBranchContext();
  const isPharmacy = branchType === 'pharmacy';
  
  const { categories: pharmacyCategories, loading: pharmLoading } = useCustomCategories('pharmacy');
  const { categories: generalCategories, loading: genLoading } = useCustomCategories('general');
  const { groups: medicineGroups, addGroup } = useMedicineGroups();
  const categoriesLoading = pharmLoading || genLoading;
  const allCategories = [...new Set([...pharmacyCategories, ...generalCategories])].sort();

  const [medicineData, setMedicineData] = useState({
    name: '',
    generic_name: '',
    category: '',
    manufacturer: '',
    batch_number: '',
    country_name: '',
    purchase_price: '',
    selling_price: '',
    stock_quantity: '',
    minimum_stock_level: '',
    units_per_pack: '',
    unit_label: 'strip',
    expiry_date: '',
    expiry_alert_enabled: true,
    branch_id: '',
    item_type: 'full_pcs' as 'full_pcs' | 'measurable',
    strength: '',
    medicine_group: '',
  });
  const [customGroup, setCustomGroup] = useState('');
  const [packagingMode, setPackagingMode] = useState<'with_strip' | 'no_strip'>('no_strip');
  const [stripsPerPack, setStripsPerPack] = useState('');
  const [unitsPerStrip, setUnitsPerStrip] = useState('');
  const [measurableUnit, setMeasurableUnit] = useState<string>('kg');
  const [recordInExpense, setRecordInExpense] = useState(true);
  const [originalRecordInExpense, setOriginalRecordInExpense] = useState(true);
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);
  const [userRole, setUserRole] = useState<'owner' | 'staff' | null>(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const fetchUserRoleAndBranches = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();
      
      if (profile) {
        setUserRole(profile.role as 'owner' | 'staff');
        if (profile.role === 'owner') {
          const { data: branchesData } = await supabase
            .from('pharmacy_branches')
            .select('id, name')
            .eq('pharmacy_owner_id', user.id)
            .order('is_main_branch', { ascending: false })
            .order('name');
          if (branchesData) setBranches(branchesData);
        }
      }
    };
    if (open) fetchUserRoleAndBranches();
  }, [open]);

  useEffect(() => {
    if (medicine && open) {
      const medicineWithBranch = medicine as MedicineWithBranch & { units_per_pack?: number; unit_label?: string; item_type?: string; strips_per_pack?: number; units_per_strip?: number };
      const unitLbl = medicineWithBranch.unit_label || 'strip';
      const isMeas = (medicineWithBranch.item_type === 'measurable') || MEASURABLE_UNIT_OPTIONS.some(o => o.value === unitLbl.toLowerCase());
      if (isMeas) {
        setMeasurableUnit(unitLbl.toLowerCase());
      }

      // Detect strip packaging from persisted columns
      const hasStripBreakdown = !!(medicineWithBranch.strips_per_pack && medicineWithBranch.units_per_strip);
      setPackagingMode(hasStripBreakdown ? 'with_strip' : 'no_strip');
      setStripsPerPack(hasStripBreakdown ? String(medicineWithBranch.strips_per_pack) : '');
      setUnitsPerStrip(hasStripBreakdown ? String(medicineWithBranch.units_per_strip) : '');

      setMedicineData({
        name: medicine.name || '',
        generic_name: medicine.generic_name || '',
        category: medicine.category || '',
        manufacturer: medicine.manufacturer || '',
        batch_number: medicine.batch_number || '',
        country_name: medicine.country_name || '',
        purchase_price: medicine.purchase_price.toString(),
        selling_price: medicine.selling_price.toString(),
        stock_quantity: medicine.stock_quantity.toString(),
        minimum_stock_level: medicine.minimum_stock_level.toString(),
        units_per_pack: medicineWithBranch.units_per_pack ? medicineWithBranch.units_per_pack.toString() : '',
        unit_label: unitLbl,
        expiry_date: medicine.expiry_date || '',
        expiry_alert_enabled: medicine.expiry_alert_enabled ?? true,
        branch_id: medicineWithBranch.branch_id || '',
        item_type: isMeas ? 'measurable' : ((medicineWithBranch.item_type as 'full_pcs' | 'measurable') || 'full_pcs'),
        strength: medicine.strength || '',
        medicine_group: medicine.medicine_group || '',
      });
      setCustomGroup('');

      // Check if an expense exists for this item
      (async () => {
        const { data: existingExpense } = await supabase
          .from('expenses')
          .select('id')
          .ilike('description', `%Purchase of ${medicine.name}%`)
          .eq('category', 'Stock Purchase')
          .limit(1);
        const hasExpense = existingExpense && existingExpense.length > 0;
        setRecordInExpense(hasExpense);
        setOriginalRecordInExpense(hasExpense);
      })();
    }
  }, [medicine, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!medicine) return;
    setLoading(true);

    try {
      const isMeas = medicineData.item_type === 'measurable';
      const unitLabel = isMeas ? measurableUnit : (medicineData.unit_label || 'strip');

      // Compute units_per_pack: strip mode → strips × units/strip
      let computedUnitsPerPack: number | null = null;
      if (!isMeas) {
        if (packagingMode === 'with_strip') {
          const sp = parseInt(stripsPerPack);
          const ups = parseInt(unitsPerStrip);
          if (!sp || !ups || sp < 1 || ups < 1) {
            toast({ title: 'Error', description: 'Strips per item and total items are required for strip packaging', variant: 'destructive' });
            setLoading(false);
            return;
          }
          computedUnitsPerPack = sp * ups;
        } else if (medicineData.units_per_pack) {
          computedUnitsPerPack = parseInt(medicineData.units_per_pack);
        }
      }

      // Resolve medicine group (pharmacy mode)
      let resolvedGroup: string | null = null;
      if (isPharmacy) {
        if (medicineData.medicine_group === '__custom__') {
          const cg = customGroup.trim();
          if (cg) {
            await addGroup(cg);
            resolvedGroup = cg;
          }
        } else if (medicineData.medicine_group) {
          resolvedGroup = medicineData.medicine_group;
        }
      }

      const updateData: any = {
        name: medicineData.name,
        generic_name: medicineData.generic_name || null,
        category: medicineData.category || 'other',
        manufacturer: medicineData.manufacturer || null,
        batch_number: isPharmacy ? (medicineData.batch_number || null) : null,
        country_name: medicineData.country_name || null,
        purchase_price: parseFloat(medicineData.purchase_price),
        selling_price: parseFloat(medicineData.selling_price),
        
        minimum_stock_level: parseInt(medicineData.minimum_stock_level),
        units_per_pack: computedUnitsPerPack,
        unit_label: unitLabel,
        expiry_date: isPharmacy ? (medicineData.expiry_date || null) : null,
        expiry_alert_enabled: isPharmacy ? medicineData.expiry_alert_enabled : false,
        item_type: medicineData.item_type,
        strips_per_pack: !isMeas && packagingMode === 'with_strip' ? parseInt(stripsPerPack) : null,
        units_per_strip: !isMeas && packagingMode === 'with_strip' ? parseInt(unitsPerStrip) : null,
        // Pharmacy-only fields
        strength: isPharmacy ? (medicineData.strength.trim() || null) : null,
        medicine_group: isPharmacy ? resolvedGroup : null,
      };
      
      if (userRole === 'owner' && medicineData.branch_id) {
        updateData.branch_id = medicineData.branch_id;
      }

      const { error } = await supabase.from('medicines').update(updateData).eq('id', medicine.id);
      if (error) throw error;

      // Expense sync logic
      const { data: { user } } = await supabase.auth.getUser();
      if (recordInExpense && !originalRecordInExpense) {
        // Unchecked → Checked: add expense
        const stockQty = isMeas ? parseFloat(medicineData.stock_quantity) : parseInt(medicineData.stock_quantity);
        const purchasePrice = parseFloat(medicineData.purchase_price);
        if (stockQty > 0 && purchasePrice > 0) {
          const expenseAmount = stockQty * purchasePrice;
          const unit = isMeas ? measurableUnit.toUpperCase() : (medicineData.unit_label || 'pcs');
          await supabase.from('expenses').insert({
            description: `Purchase of ${medicineData.name} (${stockQty} ${unit})`,
            amount: expenseAmount,
            category: 'Stock Purchase',
            created_by: user?.id || null,
            branch_id: medicineData.branch_id || null,
          });
        }
      } else if (!recordInExpense && originalRecordInExpense) {
        // Checked → Unchecked: remove expense
        await supabase
          .from('expenses')
          .delete()
          .ilike('description', `%Purchase of ${medicine.name}%`)
          .eq('category', 'Stock Purchase');
      }

      toast({ title: "Success", description: `${isPharmacy ? 'Medicine' : 'Item'} updated successfully` });
      onMedicineUpdated();
    } catch (error) {
      toast({ title: "Error", description: `Failed to update ${isPharmacy ? 'medicine' : 'item'}`, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isPharmacy ? 'Edit Medicine' : 'Edit Item'}</DialogTitle>
          <DialogDescription>
            Update the {isPharmacy ? 'medicine' : 'item'} information below.
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Item Type */}
          <div className="space-y-3 p-4 rounded-lg border bg-muted/30">
            <Label className="text-sm font-semibold">Item Type</Label>
            <RadioGroup
              value={medicineData.item_type}
              onValueChange={(val) => setMedicineData({ ...medicineData, item_type: val as 'full_pcs' | 'measurable' })}
              className="flex gap-6"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="full_pcs" id="edit_type_full_pcs" />
                <Label htmlFor="edit_type_full_pcs" className="cursor-pointer">
                  <span className="font-medium">Full PCS</span>
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="measurable" id="edit_type_measurable" />
                <Label htmlFor="edit_type_measurable" className="cursor-pointer">
                  <span className="font-medium">Measurable</span>
                </Label>
              </div>
            </RadioGroup>
          </div>

          <div className="space-y-2">
            <Label htmlFor="name">{isPharmacy ? 'Medicine Name' : 'Item Name'} *</Label>
            <Input id="name" value={medicineData.name} onChange={(e) => setMedicineData({ ...medicineData, name: e.target.value })} required />
          </div>

          <div className="space-y-2">
            <Label htmlFor="generic_name">{isPharmacy ? 'Generic Name' : 'Description'}</Label>
            <Input id="generic_name" value={medicineData.generic_name} onChange={(e) => setMedicineData({ ...medicineData, generic_name: e.target.value })} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="category">Category *</Label>
            <Select 
              key={`category-select-${medicineData.category}-${allCategories.length}`}
              value={medicineData.category || undefined} 
              onValueChange={(value: string) => setMedicineData({ ...medicineData, category: value })}
            >
              <SelectTrigger>
                <SelectValue placeholder={categoriesLoading ? "Loading categories..." : "Select category"} />
              </SelectTrigger>
              <SelectContent>
                {(() => {
                  const currentCat = medicineData.category;
                  const displayList = [...allCategories];
                  if (currentCat && !displayList.includes(currentCat)) {
                    displayList.push(currentCat);
                  }
                  displayList.sort();
                  return displayList.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {cat.charAt(0).toUpperCase() + cat.slice(1).replace(/_/g, ' ')}
                    </SelectItem>
                  ));
                })()}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="manufacturer">{isPharmacy ? 'Manufacturer' : 'Brand'}</Label>
            <Input id="manufacturer" value={medicineData.manufacturer} onChange={(e) => setMedicineData({ ...medicineData, manufacturer: e.target.value })} />
          </div>

          {isPharmacy && (
            <div className="space-y-2">
              <Label htmlFor="batch_number">Batch Number</Label>
              <Input id="batch_number" value={medicineData.batch_number} onChange={(e) => setMedicineData({ ...medicineData, batch_number: e.target.value })} />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="country_name">Country Name</Label>
            <Input id="country_name" value={medicineData.country_name} onChange={(e) => setMedicineData({ ...medicineData, country_name: e.target.value })} />
          </div>

          {userRole === 'owner' && branches.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="branch_id">Assign to Branch *</Label>
              <Select value={medicineData.branch_id} onValueChange={(value) => setMedicineData({ ...medicineData, branch_id: value })}>
                <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
                <SelectContent>
                  {branches.map((branch) => (
                    <SelectItem key={branch.id} value={branch.id}>{branch.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="purchase_price">Purchase Price *</Label>
              <Input id="purchase_price" type="number" step="0.01" value={medicineData.purchase_price} onChange={(e) => setMedicineData({ ...medicineData, purchase_price: e.target.value })} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="selling_price">Selling Price *</Label>
              <Input id="selling_price" type="number" step="0.01" value={medicineData.selling_price} onChange={(e) => setMedicineData({ ...medicineData, selling_price: e.target.value })} required />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="stock_quantity">Stock Quantity</Label>
              <Input id="stock_quantity" type="number" value={medicineData.stock_quantity} disabled className="opacity-60 cursor-not-allowed" />
              <p className="text-xs text-muted-foreground">Use "Adjust Stock" to change quantity</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="minimum_stock_level">Minimum Stock Level(for alert!) *</Label>
              <Input id="minimum_stock_level" type="number" value={medicineData.minimum_stock_level} onChange={(e) => setMedicineData({ ...medicineData, minimum_stock_level: e.target.value })} required />
            </div>
          </div>

          {/* Measurable unit selector */}
          {medicineData.item_type === 'measurable' && (
            <div className="space-y-2">
              <Label>Measurement Unit *</Label>
              <Select value={measurableUnit} onValueChange={setMeasurableUnit}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MEASURABLE_UNIT_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Unit Label & Packaging — only for Full PCS */}
          {medicineData.item_type === 'full_pcs' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="unit_label">Unit Label</Label>
                <Input id="unit_label" value={medicineData.unit_label} onChange={(e) => setMedicineData({ ...medicineData, unit_label: e.target.value })} placeholder="e.g. strip, piece, bottle" />
              </div>

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
                      <Input type="number" min="1" value={stripsPerPack} onChange={(e) => setStripsPerPack(e.target.value)} placeholder="e.g. 10" />
                    </div>
                    <div className="space-y-2">
                      <Label>Total Items *</Label>
                      <Input type="number" min="1" value={unitsPerStrip} onChange={(e) => setUnitsPerStrip(e.target.value)} placeholder="e.g. 10" />
                    </div>
                  </div>
                  {stripsPerPack && unitsPerStrip && parseInt(stripsPerPack) > 0 && parseInt(unitsPerStrip) > 0 && (
                    <div className="text-xs text-muted-foreground -mt-2">
                      Total: {parseInt(stripsPerPack) * parseInt(unitsPerStrip)} units per pack
                    </div>
                  )}
                </>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="units_per_pack">Units Per Stock</Label>
                  <Input id="units_per_pack" type="number" min="1" value={medicineData.units_per_pack} onChange={(e) => setMedicineData({ ...medicineData, units_per_pack: e.target.value })} placeholder="Leave empty if not sold by unit" />
                </div>
              )}
            </>
          )}

          {isPharmacy && (
            <>
              <div className="space-y-2">
                <Label htmlFor="expiry_date">Expiry Date</Label>
                <Input id="expiry_date" type="date" value={medicineData.expiry_date} onChange={(e) => setMedicineData({ ...medicineData, expiry_date: e.target.value })} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="expiry_alert_enabled">Alert me before expiry</Label>
                <Select value={medicineData.expiry_alert_enabled ? "1" : "0"} onValueChange={(value) => setMedicineData({ ...medicineData, expiry_alert_enabled: value !== "0" })}>
                  <SelectTrigger><SelectValue placeholder="Select alert period" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">No Alert</SelectItem>
                    <SelectItem value="1">1 Month</SelectItem>
                    <SelectItem value="2">2 Months</SelectItem>
                    <SelectItem value="3">3 Months</SelectItem>
                    <SelectItem value="4">4 Months</SelectItem>
                    <SelectItem value="5">5 Months</SelectItem>
                    <SelectItem value="6">6 Months</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          {/* Record in Expense checkbox */}
          <div className="flex items-center space-x-2 rounded-md border p-3 bg-muted/30">
            <Checkbox
              id="edit-record-in-expense"
              checked={recordInExpense}
              onCheckedChange={(checked) => setRecordInExpense(!!checked)}
            />
            <Label htmlFor="edit-record-in-expense" className="text-sm cursor-pointer">
              Record in Expense
            </Label>
          </div>

          <div className="flex gap-2 pt-4">
            <Button type="submit" disabled={loading} className="flex-1">
              {loading ? "Updating..." : `Update ${isPharmacy ? 'Medicine' : 'Item'}`}
            </Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
