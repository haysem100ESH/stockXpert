import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';

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
  const [sellingPrice, setSellingPrice] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (item && open) {
      setSellingPrice(item.selling_price.toString());
      setPurchasePrice(item.purchase_price.toString());
      setExpiryDate(item.expiry_date || '');
    }
  }, [item, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!item) return;
    setLoading(true);

    try {
      const { error } = await supabase
        .from('branch_items')
        .update({
          selling_price: parseFloat(sellingPrice),
          purchase_price: parseFloat(purchasePrice),
          expiry_date: expiryDate || null,
          updated_at: new Date().toISOString(),
        })
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
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Edit Branch Item</DialogTitle>
          <DialogDescription>
            Update branch-specific pricing and details. Catalog information is read-only.
          </DialogDescription>
        </DialogHeader>

        {/* Read-only catalog info */}
        <div className="bg-muted/40 rounded-lg p-4 space-y-2">
          <p className="font-semibold">{item.name}</p>
          {item.generic_name && <p className="text-sm text-muted-foreground">{item.generic_name}</p>}
          <div className="flex gap-2 flex-wrap">
            <Badge variant="outline">{item.category}</Badge>
            {item.manufacturer && <Badge variant="secondary">{item.manufacturer}</Badge>}
            {item.item_type && <Badge variant="secondary">{item.item_type}</Badge>}
          </div>
          <div className="text-sm text-muted-foreground">
            Current Stock: <span className="font-medium text-foreground">{item.quantity}</span>
            {item.unit_label && ` ${item.unit_label}`}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
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

          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Save Changes
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
