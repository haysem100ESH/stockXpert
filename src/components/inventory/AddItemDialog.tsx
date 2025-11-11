import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useBranchContext } from '@/hooks/useBranchContext';

interface AddItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onItemAdded: () => void;
}

const itemCategories = [
  'medical_supplies', 'personal_care', 'vitamins_supplements', 'first_aid', 
  'equipment', 'hygiene', 'baby_care', 'other'
];

export default function AddItemDialog({ open, onOpenChange, onItemAdded }: AddItemDialogProps) {
  const [loading, setLoading] = useState(false);
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string>('');
  const { toast } = useToast();
  const { selectedBranch, userBranch } = useBranchContext();
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
        
        if (profile.role === 'owner') {
          const { data: branchesData } = await supabase
            .from('pharmacy_branches')
            .select('id, name')
            .eq('pharmacy_owner_id', user.id)
            .order('is_main_branch', { ascending: false })
            .order('name');
          
          if (branchesData) {
            setBranches(branchesData);
            if (selectedBranch) {
              setSelectedBranchId(selectedBranch);
            } else if (branchesData.length > 0) {
              setSelectedBranchId(branchesData[0].id);
            }
          }
        } else if (profile.role === 'staff' && userBranch) {
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
    const { data: { user } } = await supabase.auth.getUser();
    
    const itemData = {
      name: formData.get('name') as string,
      generic_name: formData.get('description') as string || null,
      category: 'other' as const,
      manufacturer: formData.get('brand') as string || null,
      batch_number: formData.get('batch_number') as string || null,
      purchase_price: parseFloat(formData.get('purchase_price') as string),
      selling_price: parseFloat(formData.get('selling_price') as string),
      stock_quantity: parseInt(formData.get('stock_quantity') as string),
      minimum_stock_level: parseInt(formData.get('minimum_stock_level') as string),
      expiry_date: formData.get('expiry_date') as string || null,
      branch_id: selectedBranchId || userBranch || selectedBranch || null,
      created_by: user?.id || null
    };

    try {
      const { error } = await supabase
        .from('medicines')
        .insert([itemData]);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Item added successfully"
      });

      onItemAdded();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to add item",
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
          <DialogTitle>Add New Item</DialogTitle>
          <DialogDescription>
            Enter the details for the new inventory item
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Item Name *</Label>
              <Input id="name" name="name" required />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Input id="description" name="description" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="category">Category *</Label>
              <Select name="category" required disabled defaultValue="other">
                <SelectTrigger>
                  <SelectValue placeholder="Other (Items)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="other">Other (Items)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Items are automatically categorized as "Other"</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="brand">Brand</Label>
              <Input id="brand" name="brand" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="batch_number">Batch Number</Label>
              <Input id="batch_number" name="batch_number" />
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
                defaultValue={10}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="expiry_date">Expiry Date</Label>
              <Input id="expiry_date" name="expiry_date" type="date" />
            </div>
          </div>

          <div className="flex justify-end space-x-2 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add Item
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
