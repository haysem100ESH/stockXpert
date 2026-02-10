import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

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
  const [medicineData, setMedicineData] = useState({
    name: '',
    generic_name: '',
    category: '' as 'tablet' | 'capsule' | 'syrup' | 'injection' | 'cream' | 'ointment' | 'drops' | 'inhaler' | 'other',
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
    branch_id: ''
  });
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
        
        // If owner, fetch their branches
        if (profile.role === 'owner') {
          const { data: branchesData } = await supabase
            .from('pharmacy_branches')
            .select('id, name')
            .eq('pharmacy_owner_id', user.id)
            .order('is_main_branch', { ascending: false })
            .order('name');
          
          if (branchesData) {
            setBranches(branchesData);
          }
        }
      }
    };
    
    if (open) {
      fetchUserRoleAndBranches();
    }
  }, [open]);

  useEffect(() => {
    if (medicine && open) {
      const medicineWithBranch = medicine as MedicineWithBranch & { stripes_per_pack?: number };
      setMedicineData({
        name: medicine.name,
        generic_name: medicine.generic_name || '',
        category: medicine.category as any,
        manufacturer: medicine.manufacturer || '',
        batch_number: medicine.batch_number || '',
        country_name: medicine.country_name || '',
        purchase_price: medicine.purchase_price.toString(),
        selling_price: medicine.selling_price.toString(),
        stock_quantity: medicine.stock_quantity.toString(),
        minimum_stock_level: medicine.minimum_stock_level.toString(),
        stripes_per_pack: medicineWithBranch.stripes_per_pack ? medicineWithBranch.stripes_per_pack.toString() : '',
        expiry_date: medicine.expiry_date || '',
        expiry_alert_enabled: medicine.expiry_alert_enabled ?? true,
        branch_id: medicineWithBranch.branch_id || ''
      });
    }
  }, [medicine, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!medicine) return;
    
    setLoading(true);

    try {
      const updateData: any = {
        name: medicineData.name,
        generic_name: medicineData.generic_name || null,
        category: medicineData.category,
        manufacturer: medicineData.manufacturer || null,
        batch_number: medicineData.batch_number || null,
        country_name: medicineData.country_name || null,
        purchase_price: parseFloat(medicineData.purchase_price),
        selling_price: parseFloat(medicineData.selling_price),
        stock_quantity: parseInt(medicineData.stock_quantity),
        minimum_stock_level: parseInt(medicineData.minimum_stock_level),
        stripes_per_pack: medicineData.stripes_per_pack ? parseInt(medicineData.stripes_per_pack) : null,
        expiry_date: medicineData.expiry_date || null,
        expiry_alert_enabled: medicineData.expiry_alert_enabled
      };
      
      // Only update branch_id if user is owner and a branch is selected
      if (userRole === 'owner' && medicineData.branch_id) {
        updateData.branch_id = medicineData.branch_id;
      }
      
      const { error } = await supabase
        .from('medicines')
        .update(updateData)
        .eq('id', medicine.id);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Medicine updated successfully"
      });

      onMedicineUpdated();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update medicine",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Medicine</DialogTitle>
          <DialogDescription>
            Update the medicine information below.
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Medicine Name *</Label>
            <Input
              id="name"
              value={medicineData.name}
              onChange={(e) => setMedicineData({ ...medicineData, name: e.target.value })}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="generic_name">Generic Name</Label>
            <Input
              id="generic_name"
              value={medicineData.generic_name}
              onChange={(e) => setMedicineData({ ...medicineData, generic_name: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="category">Category *</Label>
            <Select
              value={medicineData.category}
              onValueChange={(value: any) => setMedicineData({ ...medicineData, category: value })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tablet">Tablet</SelectItem>
                <SelectItem value="capsule">Capsule</SelectItem>
                <SelectItem value="syrup">Syrup</SelectItem>
                <SelectItem value="injection">Injection</SelectItem>
                <SelectItem value="cream">Cream</SelectItem>
                <SelectItem value="ointment">Ointment</SelectItem>
                <SelectItem value="drops">Drops</SelectItem>
                <SelectItem value="inhaler">Inhaler</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="manufacturer">Manufacturer</Label>
            <Input
              id="manufacturer"
              value={medicineData.manufacturer}
              onChange={(e) => setMedicineData({ ...medicineData, manufacturer: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="batch_number">Batch Number</Label>
            <Input
              id="batch_number"
              value={medicineData.batch_number}
              onChange={(e) => setMedicineData({ ...medicineData, batch_number: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="country_name">Country Name</Label>
            <Input
              id="country_name"
              value={medicineData.country_name}
              onChange={(e) => setMedicineData({ ...medicineData, country_name: e.target.value })}
            />
          </div>

          {userRole === 'owner' && branches.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="branch_id">Assign to Branch *</Label>
              <Select 
                value={medicineData.branch_id} 
                onValueChange={(value) => setMedicineData({ ...medicineData, branch_id: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select branch" />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((branch) => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="purchase_price">Purchase Price *</Label>
              <Input
                id="purchase_price"
                type="number"
                step="0.01"
                value={medicineData.purchase_price}
                onChange={(e) => setMedicineData({ ...medicineData, purchase_price: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="selling_price">Selling Price *</Label>
              <Input
                id="selling_price"
                type="number"
                step="0.01"
                value={medicineData.selling_price}
                onChange={(e) => setMedicineData({ ...medicineData, selling_price: e.target.value })}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="stock_quantity">Stock Quantity *</Label>
              <Input
                id="stock_quantity"
                type="number"
                value={medicineData.stock_quantity}
                onChange={(e) => setMedicineData({ ...medicineData, stock_quantity: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="minimum_stock_level">Minimum Stock Level *</Label>
              <Input
                id="minimum_stock_level"
                type="number"
                value={medicineData.minimum_stock_level}
                onChange={(e) => setMedicineData({ ...medicineData, minimum_stock_level: e.target.value })}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="stripes_per_pack">Stripes Per Pack</Label>
            <Input
              id="stripes_per_pack"
              type="number"
              min="1"
              value={medicineData.stripes_per_pack}
              onChange={(e) => setMedicineData({ ...medicineData, stripes_per_pack: e.target.value })}
              placeholder="Leave empty if not sold by stripe"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="expiry_date">Expiry Date</Label>
            <Input
              id="expiry_date"
              type="date"
              value={medicineData.expiry_date}
              onChange={(e) => setMedicineData({ ...medicineData, expiry_date: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="expiry_alert_enabled">Alert me before expiry</Label>
            <Select 
              value={medicineData.expiry_alert_enabled ? "1" : "0"} 
              onValueChange={(value) => setMedicineData({ ...medicineData, expiry_alert_enabled: value !== "0" })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select alert period" />
              </SelectTrigger>
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

          <div className="flex gap-2 pt-4">
            <Button type="submit" disabled={loading} className="flex-1">
              {loading ? "Updating..." : "Update Medicine"}
            </Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}