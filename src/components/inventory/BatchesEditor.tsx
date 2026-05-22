import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Plus, Trash2, Save } from 'lucide-react';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { getBatchesForItem, createBatch, syncBranchItemQuantity, type InventoryBatch } from '@/lib/batchInventory';

interface BatchesEditorProps {
  branchId: string;
  medicineId: string;
  branchItemId: string;
  defaultPurchasePrice: number;
  defaultSellingPrice: number;
  onChanged?: () => void;
}

type DraftBatch = {
  id: string;            // existing UUID or `new-${idx}`
  isNew: boolean;
  batch_number: string;
  remaining_quantity: string;
  purchase_price: string;
  selling_price: string;
  expiry_date: string;
  _original?: InventoryBatch;
};

export default function BatchesEditor({
  branchId, medicineId, branchItemId,
  defaultPurchasePrice, defaultSellingPrice, onChanged,
}: BatchesEditorProps) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [drafts, setDrafts] = useState<DraftBatch[]>([]);
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const data = await getBatchesForItem(branchItemId);
    setDrafts(data.map(b => ({
      id: b.id,
      isNew: false,
      batch_number: b.batch_number || '',
      remaining_quantity: String(b.remaining_quantity ?? 0),
      purchase_price: String(b.purchase_price ?? 0),
      selling_price: String(b.selling_price ?? 0),
      expiry_date: b.expiry_date || '',
      _original: b,
    })));
    setDeletedIds([]);
    setLoading(false);
  };

  useEffect(() => { if (branchItemId) load(); }, [branchItemId]);

  const totalQty = drafts.reduce((s, d) => s + (parseFloat(d.remaining_quantity) || 0), 0);

  const addBatch = () => {
    setDrafts(d => [...d, {
      id: `new-${Date.now()}-${d.length}`,
      isNew: true,
      batch_number: '',
      remaining_quantity: '0',
      purchase_price: String(defaultPurchasePrice ?? 0),
      selling_price: String(defaultSellingPrice ?? 0),
      expiry_date: '',
    }]);
  };

  const updateField = (id: string, field: keyof DraftBatch, value: string) => {
    setDrafts(d => d.map(b => b.id === id ? { ...b, [field]: value } : b));
  };

  const removeBatch = (id: string) => {
    setDrafts(d => d.filter(b => b.id !== id));
    if (!id.startsWith('new-')) setDeletedIds(ids => [...ids, id]);
  };

  const hasMissingBatchNumber = drafts.some(d => !d.batch_number.trim());

  const save = async () => {
    if (hasMissingBatchNumber) {
      toast({ title: 'Batch number is required', description: 'Please enter a batch number for every batch.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();

      for (const id of deletedIds) {
        const { error } = await supabase.from('inventory_batches').delete().eq('id', id);
        if (error) throw error;
      }

      for (const d of drafts) {
        const qty = parseFloat(d.remaining_quantity);
        const buy = parseFloat(d.purchase_price);
        const sell = parseFloat(d.selling_price);
        if (!d.batch_number.trim()) throw new Error('Batch number is required for every batch.');
        if (isNaN(qty) || qty < 0) throw new Error(`Invalid quantity for batch "${d.batch_number}"`);
        if (isNaN(buy) || buy < 0) throw new Error(`Invalid buy price for batch "${d.batch_number}"`);
        if (isNaN(sell) || sell < 0) throw new Error(`Invalid sell price for batch "${d.batch_number}"`);

        if (d.isNew) {
          const { error } = await createBatch({
            branchId,
            medicineId,
            branchItemId,
            batchNumber: d.batch_number.trim(),
            quantity: qty,
            purchasePrice: buy,
            sellingPrice: sell,
            expiryDate: d.expiry_date || null,
            createdBy: user?.id || null,
          });
          if (error) throw error;
        } else {
          const orig = d._original!;
          const update: any = {
            batch_number: d.batch_number.trim(),
            purchase_price: buy,
            selling_price: sell,
            expiry_date: d.expiry_date || null,
            updated_at: new Date().toISOString(),
          };
          update.remaining_quantity = qty;
          if (qty > Number(orig.quantity)) update.quantity = qty;
          const { error } = await supabase.from('inventory_batches').update(update).eq('id', d.id);
          if (error) throw error;
        }
      }

      await syncBranchItemQuantity(branchItemId);
      toast({ title: 'Batches saved', description: 'Item batches updated successfully.' });
      window.dispatchEvent(new Event('app:refresh'));
      onChanged?.();
      await load();
    } catch (e: any) {
      toast({ title: 'Save failed', description: e.message || 'Unknown error', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm">
          <span className="text-muted-foreground">Total stock (sum of batches): </span>
          <span className="font-semibold">{totalQty}</span>
          <Badge variant="outline" className="ml-2 text-xs">{drafts.length} batch{drafts.length !== 1 ? 'es' : ''}</Badge>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={addBatch}>
          <Plus className="h-4 w-4 mr-1" /> Add Batch
        </Button>
      </div>

      <div className="overflow-x-auto border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[120px]">Batch #</TableHead>
              <TableHead className="min-w-[90px]">Stock</TableHead>
              <TableHead className="min-w-[110px]">Buy Price</TableHead>
              <TableHead className="min-w-[110px]">Sell Price</TableHead>
              <TableHead className="min-w-[150px]">Expiry</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {drafts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-6">
                  No batches yet. Click <strong>Add Batch</strong> to create one.
                </TableCell>
              </TableRow>
            ) : drafts.map(d => (
              <TableRow key={d.id}>
                <TableCell>
                  <Input value={d.batch_number} onChange={e => updateField(d.id, 'batch_number', e.target.value)} placeholder="e.g. BN-001" />
                </TableCell>
                <TableCell>
                  <Input type="number" step="0.01" min="0" value={d.remaining_quantity} onChange={e => updateField(d.id, 'remaining_quantity', e.target.value)} />
                </TableCell>
                <TableCell>
                  <Input type="number" step="0.01" min="0" value={d.purchase_price} onChange={e => updateField(d.id, 'purchase_price', e.target.value)} />
                </TableCell>
                <TableCell>
                  <Input type="number" step="0.01" min="0" value={d.selling_price} onChange={e => updateField(d.id, 'selling_price', e.target.value)} />
                </TableCell>
                <TableCell>
                  <Input type="date" value={d.expiry_date} onChange={e => updateField(d.id, 'expiry_date', e.target.value)} />
                </TableCell>
                <TableCell>
                  <Button type="button" size="sm" variant="ghost" onClick={() => removeBatch(d.id)} title="Delete batch">
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground">
        Sales auto-deduct from the earliest-expiring batch first (FEFO). Deleting a batch removes it permanently.
      </p>

      <Button type="button" className="w-full" onClick={save} disabled={saving}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
        Save Batch Changes
      </Button>
    </div>
  );
}
