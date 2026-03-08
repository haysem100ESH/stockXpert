import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useBranchContext } from '@/hooks/useBranchContext';

interface RecordPurchaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplierId: string;
  supplierName: string;
  onPurchaseRecorded: () => void;
}

export default function RecordPurchaseDialog({ open, onOpenChange, supplierId, supplierName, onPurchaseRecorded }: RecordPurchaseDialogProps) {
  const [formData, setFormData] = useState({
    item_name: '',
    quantity: '',
    unit_cost: '',
    payment_type: 'paid' as 'paid' | 'credit',
    notes: '',
  });
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const { profile } = useAuth();
  const { selectedBranch } = useBranchContext();

  const totalCost = (parseFloat(formData.quantity) || 0) * (parseFloat(formData.unit_cost) || 0);

  const resetForm = () => {
    setFormData({ item_name: '', quantity: '', unit_cost: '', payment_type: 'paid', notes: '' });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBranch) {
      toast({ title: 'Error', description: 'Please select a branch first', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      const quantity = parseFloat(formData.quantity);
      const unitCost = parseFloat(formData.unit_cost);
      const total = quantity * unitCost;

      // Insert purchase record
      const { error: purchaseErr } = await supabase.from('supplier_purchases').insert({
        supplier_id: supplierId,
        item_name: formData.item_name,
        quantity,
        unit_cost: unitCost,
        total_cost: total,
        payment_type: formData.payment_type,
        notes: formData.notes || null,
        branch_id: selectedBranch,
        created_by: profile?.id,
      });
      if (purchaseErr) throw purchaseErr;

      // If credit, update supplier debt
      if (formData.payment_type === 'credit') {
        // Check if debt record exists
        const { data: existing } = await supabase
          .from('supplier_debts')
          .select('id, total_debt')
          .eq('supplier_id', supplierId)
          .maybeSingle();

        if (existing) {
          await supabase.from('supplier_debts').update({
            total_debt: Number(existing.total_debt) + total,
            last_updated: new Date().toISOString(),
          }).eq('id', existing.id);
        } else {
          await supabase.from('supplier_debts').insert({
            supplier_id: supplierId,
            total_debt: total,
            branch_id: selectedBranch,
          });
        }
      }

      toast({ title: 'Success', description: `Purchase of ${formData.item_name} recorded` });
      resetForm();
      onPurchaseRecorded();
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to record purchase', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) resetForm(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record Purchase — {supplierName}</DialogTitle>
          <DialogDescription>Record a new purchase from this supplier.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Item Name *</Label>
            <Input value={formData.item_name} onChange={(e) => setFormData({ ...formData, item_name: e.target.value })} required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Quantity *</Label>
              <Input type="number" step="0.01" min="0.01" value={formData.quantity} onChange={(e) => setFormData({ ...formData, quantity: e.target.value })} required />
            </div>
            <div className="space-y-2">
              <Label>Unit Cost (ETB) *</Label>
              <Input type="number" step="0.01" min="0" value={formData.unit_cost} onChange={(e) => setFormData({ ...formData, unit_cost: e.target.value })} required />
            </div>
          </div>
          <div className="p-3 bg-muted rounded-md">
            <p className="text-sm font-medium">Total Cost: <span className="text-primary">ETB {totalCost.toFixed(2)}</span></p>
          </div>
          <div className="space-y-2">
            <Label>Payment Type *</Label>
            <Select value={formData.payment_type} onValueChange={(v: 'paid' | 'credit') => setFormData({ ...formData, payment_type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="credit">Credit (Add to Supplier Debt)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} rows={2} />
          </div>
          <div className="flex gap-2 pt-2">
            <Button type="submit" disabled={loading} className="flex-1">{loading ? 'Recording...' : 'Record Purchase'}</Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
