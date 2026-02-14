import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useBranchContext } from '@/hooks/useBranchContext';
import { useCustomCategories } from '@/hooks/useCustomCategories';
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

interface AddMedicineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMedicineAdded: () => void;
  replicateData?: Medicine | null;
}

// Default categories removed - now using useCustomCategories hook

export default function AddMedicineDialog({ open, onOpenChange, onMedicineAdded, replicateData }: AddMedicineDialogProps) {
  const [loading, setLoading] = useState(false);
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string>('');
  const { toast } = useToast();
  const { selectedBranch, userBranch } = useBranchContext();
  const { categories } = useCustomCategories('pharmacy');
  
  // Fetch user profile to check role
  const [userRole, setUserRole] = useState<'owner' | 'staff' | null>(null);
  
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
            // Set default to current selected branch or first branch
            if (selectedBranch) {
              setSelectedBranchId(selectedBranch);
            } else if (branchesData.length > 0) {
              setSelectedBranchId(branchesData[0].id);
            }
          }
        } else if (profile.role === 'staff' && userBranch) {
          // Staff: auto-assign to their branch
          setSelectedBranchId(userBranch);
        }
      }
    };
    
    if (open) {
      fetchUserRoleAndBranches();
    }
  }, [open, selectedBranch, userBranch]);
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    
    // Get current user ID
    const { data: { user } } = await supabase.auth.getUser();
    
    const unitsPerPackValue = formData.get('units_per_pack') as string;
    const unitsPerPack = unitsPerPackValue ? parseInt(unitsPerPackValue) : null;
    
    const medicineData = {
      name: formData.get('name') as string,
      generic_name: formData.get('generic_name') as string || null,
      category: formData.get('category') as 'tablet' | 'capsule' | 'syrup' | 'injection' | 'cream' | 'ointment' | 'drops' | 'inhaler' | 'other',
      manufacturer: formData.get('manufacturer') as string || null,
      batch_number: formData.get('batch_number') as string || null,
      country_name: formData.get('country_name') as string || null,
      purchase_price: parseFloat(formData.get('purchase_price') as string),
      selling_price: parseFloat(formData.get('selling_price') as string),
      stock_quantity: parseInt(formData.get('stock_quantity') as string),
      minimum_stock_level: parseInt(formData.get('minimum_stock_level') as string),
      units_per_pack: unitsPerPack,
      unit_label: formData.get('unit_label') as string || 'strip',
      open_pack_units: 0,
      expiry_date: formData.get('expiry_date') as string || null,
      expiry_alert_enabled: formData.get('expiry_alert_enabled') === 'on',
      branch_id: selectedBranchId || userBranch || selectedBranch || null,
      created_by: user?.id || null
    };

    try {
      const { error } = await supabase
        .from('medicines')
        .insert([medicineData]);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Medicine added successfully"
      });

      onMedicineAdded();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to add medicine",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{replicateData ? 'Replicate Medicine' : 'Add New Medicine'}</DialogTitle>
          <DialogDescription>
            {replicateData ? 'Create a new medicine based on existing data' : 'Enter the details for the new medicine'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Medicine Name *</Label>
              <Input id="name" name="name" defaultValue={replicateData?.name} required />
            </div>

            <div className="space-y-2">
              <Label htmlFor="generic_name">Generic Name</Label>
              <Input id="generic_name" name="generic_name" defaultValue={replicateData?.generic_name} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="category">Category *</Label>
              <Select name="category" defaultValue={replicateData?.category} required>
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((category) => (
                    <SelectItem key={category} value={category}>
                      {category.charAt(0).toUpperCase() + category.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="manufacturer">Manufacturer</Label>
              <Input id="manufacturer" name="manufacturer" defaultValue={replicateData?.manufacturer} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="batch_number">Batch Number</Label>
              <Input id="batch_number" name="batch_number" defaultValue={replicateData?.batch_number} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="country_name">Country Name</Label>
              <Input id="country_name" name="country_name" defaultValue={replicateData?.country_name} />
            </div>

            {userRole === 'owner' && branches.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="branch_id">Assign to Branch *</Label>
                <Select value={selectedBranchId} onValueChange={setSelectedBranchId} required>
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

            <div className="space-y-2">
              <Label htmlFor="purchase_price">Purchase Price *</Label>
              <Input
                id="purchase_price"
                name="purchase_price"
                type="number"
                step="0.01"
                min="0"
                defaultValue={replicateData?.purchase_price}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="selling_price">Selling Price *</Label>
              <Input
                id="selling_price"
                name="selling_price"
                type="number"
                step="0.01"
                min="0"
                defaultValue={replicateData?.selling_price}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="stock_quantity">Stock Quantity *</Label>
              <Input
                id="stock_quantity"
                name="stock_quantity"
                type="number"
                min="0"
                defaultValue={replicateData?.stock_quantity}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="minimum_stock_level">Minimum Stock Level *</Label>
              <Input
                id="minimum_stock_level"
                name="minimum_stock_level"
                type="number"
                min="0"
                defaultValue={replicateData ? replicateData.minimum_stock_level : 10}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="unit_label">Unit Label</Label>
              <Input
                id="unit_label"
                name="unit_label"
                placeholder="e.g. strip, piece, bottle, kg"
                defaultValue="strip"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="units_per_pack">Units Per Pack</Label>
              <Input
                id="units_per_pack"
                name="units_per_pack"
                type="number"
                min="1"
                placeholder="Leave empty if not sold by unit"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="expiry_date">Expiry Date</Label>
              <Input id="expiry_date" name="expiry_date" type="date" defaultValue={replicateData?.expiry_date} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="expiry_alert_enabled">Alert me before expiry</Label>
            <Select name="expiry_alert_enabled" defaultValue="1">
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

          <div className="flex justify-end space-x-2 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {replicateData ? 'Create Medicine' : 'Add Medicine'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}