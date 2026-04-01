import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useBranchContext } from '@/hooks/useBranchContext';
import { createBatch, syncBranchItemQuantity } from '@/lib/batchInventory';

interface Medicine {
  id: string;
  name: string;
  stock_quantity: number;
  purchase_price: number;
  branch_id?: string;
  item_type?: string;
  unit_label?: string;
}

interface StockAdjustmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  medicine: Medicine | null;
  onAdjusted: () => void;
}

export default function StockAdjustmentDialog({ open, onOpenChange, medicine, onAdjusted }: StockAdjustmentDialogProps) {
  const [adjustmentType, setAdjustmentType] = useState<'increase' | 'decrease'>('increase');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [deductFromExpense, setDeductFromExpense] = useState(false);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const { profile } = useAuth();
  const { selectedBranch } = useBranchContext();

  const resetForm = () => {
    setAdjustmentType('increase');
    setQuantity('');
    setReason('');
    setDeductFromExpense(false);
  };

  const handleSubmit = async () => {
    if (!medicine || !reason.trim()) {
      toast({ title: 'Error', description: 'Reason is required.', variant: 'destructive' });
      return;
    }

    const qty = parseFloat(quantity);
    if (isNaN(qty) || qty <= 0) {
      toast({ title: 'Error', description: 'Enter a valid quantity greater than 0.', variant: 'destructive' });
      return;
    }

    if (adjustmentType === 'decrease' && qty > medicine.stock_quantity) {
      toast({ title: 'Error', description: 'Cannot decrease more than current stock.', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const newStock = adjustmentType === 'increase'
        ? medicine.stock_quantity + qty
        : medicine.stock_quantity - qty;

      // Update stock on branch_items (medicine.id is branch_items.id)
      const { error: updateErr } = await supabase
        .from('branch_items')
        .update({ quantity: newStock, updated_at: new Date().toISOString() })
        .eq('id', medicine.id);
      if (updateErr) {
        // Fallback to medicines table
        const { error: fallbackErr } = await supabase
          .from('medicines')
          .update({ stock_quantity: newStock })
          .eq('id', medicine.id);
        if (fallbackErr) throw fallbackErr;
      }

      // Create a batch for stock increase
      if (adjustmentType === 'increase') {
        const branchId = medicine.branch_id || selectedBranch;
        if (branchId) {
          // Try to create a batch — non-critical if it fails
          try {
            await createBatch({
              branchId,
              medicineId: medicine.id,
              branchItemId: medicine.id, // branch_items.id
              quantity: qty,
              purchasePrice: medicine.purchase_price,
              sellingPrice: medicine.purchase_price, // use purchase as default
              createdBy: profile?.id || null,
            });
          } catch (e) {
            console.warn('Batch creation failed during stock adjustment:', e);
          }
        }
      }

      // Record adjustment
      const branchId = medicine.branch_id || selectedBranch;
      const { error: logErr } = await supabase
        .from('inventory_stock_adjustments')
        .insert({
          medicine_id: medicine.id,
          branch_id: branchId,
          adjustment_type: adjustmentType,
          quantity: qty,
          reason: reason.trim(),
          deduct_from_expense: adjustmentType === 'decrease' ? deductFromExpense : false,
          created_by: profile?.id || null,
        });
      if (logErr) throw logErr;

      // Auto-record expense for measurable items on stock increase
      if (adjustmentType === 'increase' && medicine.item_type === 'measurable' && medicine.purchase_price > 0) {
        const expenseAmount = qty * medicine.purchase_price;
        const unit = (medicine.unit_label || 'unit').toUpperCase();
        await supabase.from('expenses').insert({
          description: `Purchase of ${medicine.name} (${qty} ${unit})`,
          amount: expenseAmount,
          category: 'Stock Purchase',
          created_by: profile?.id || null,
          branch_id: branchId,
        });
      }

      // Deduct from expenses if requested (for decrease)
      if (adjustmentType === 'decrease' && deductFromExpense) {
        const expenseAmount = qty * medicine.purchase_price;
        await supabase.from('expenses').insert({
          description: `Stock adjustment (decrease): ${medicine.name} – ${qty} units removed`,
          amount: -expenseAmount,
          category: 'Stock Adjustment',
          created_by: profile?.id || null,
          branch_id: branchId,
        });
      }

      toast({ title: 'Success', description: `Stock ${adjustmentType}d successfully.` });
      resetForm();
      onOpenChange(false);
      onAdjusted();
    } catch (err: any) {
      console.error('Stock adjustment error:', err);
      toast({ title: 'Error', description: err.message || 'Failed to adjust stock.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) resetForm(); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Adjust Stock – {medicine?.name}</DialogTitle>
          <DialogDescription>Current stock: {medicine?.stock_quantity ?? 0}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Adjustment Type</Label>
            <Select value={adjustmentType} onValueChange={(v) => setAdjustmentType(v as 'increase' | 'decrease')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="increase">Increase Stock</SelectItem>
                <SelectItem value="decrease">Decrease Stock</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Quantity</Label>
            <Input
              type="number"
              min="0.01"
              step="any"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="Enter quantity"
            />
          </div>

          <div>
            <Label>Reason (required)</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Enter reason for adjustment"
            />
          </div>

          {adjustmentType === 'decrease' && (
            <div className="flex items-center space-x-2 rounded-md border p-3">
              <Checkbox
                id="deduct-expense"
                checked={deductFromExpense}
                onCheckedChange={(checked) => setDeductFromExpense(!!checked)}
              />
              <Label htmlFor="deduct-expense" className="text-sm cursor-pointer">
                Deduct cost from expenses (ETB {quantity ? (parseFloat(quantity) * (medicine?.purchase_price || 0)).toFixed(2) : '0.00'})
              </Label>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { resetForm(); onOpenChange(false); }}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving || !reason.trim() || !quantity}>
            {saving ? 'Saving...' : 'Confirm'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
