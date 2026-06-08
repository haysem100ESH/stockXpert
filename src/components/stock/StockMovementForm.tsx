import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowRight, Package } from 'lucide-react';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { createBatch, deductFIFO, syncBranchItemQuantity } from '@/lib/batchInventory';


interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export default function StockMovementForm({ open, onOpenChange, onSuccess }: Props) {
  const [branches, setBranches] = useState<{ id: string; name: string; type: string }[]>([]);
  const [branchToLocationMap, setBranchToLocationMap] = useState<Record<string, string>>({});
  const [medicines, setMedicines] = useState<{ id: string; name: string; stock_quantity: number; branch_id?: string; branch_item_id?: string; purchase_price?: number; selling_price?: number }[]>([]);
  const [fromBranchId, setFromBranchId] = useState('');
  const [toBranchId, setToBranchId] = useState('');
  const [medicineId, setMedicineId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [movementType, setMovementType] = useState('TRANSFER');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const { toast } = useToast();
  const { profile, user } = useAuth();

  useEffect(() => {
    if (open) { fetchBranchesAndLocations(); fetchMedicines(); setShowConfirmation(false); }
  }, [open]);

  const fetchBranchesAndLocations = async () => {
    if (!profile?.id) return;
    const ownerId = profile.role === 'owner' ? profile.id : undefined;
    if (!ownerId) return;

    const [branchRes, locRes] = await Promise.all([
      supabase.from('pharmacy_branches').select('id, name, branch_type').eq('pharmacy_owner_id', ownerId).order('name'),
      supabase.from('locations').select('id, branch_id').eq('pharmacy_owner_id', ownerId),
    ]);

    const branchRows = (branchRes.data || []).map((b: any) => ({ id: b.id, name: b.name, type: b.branch_type }));
    setBranches(branchRows);

    const locMap: Record<string, string> = {};
    (locRes.data || []).forEach((l: any) => { if (l.branch_id) locMap[l.branch_id] = l.id; });

    // Auto-sync: create missing location rows for branches
    const missingBranches = branchRows.filter(b => !locMap[b.id]);
    if (missingBranches.length > 0) {
      const { data: inserted } = await supabase.from('locations').insert(
        missingBranches.map(b => ({
          pharmacy_owner_id: ownerId,
          name: b.name,
          type: b.type === 'pharmacy' ? 'pharmacy' : 'store',
          branch_id: b.id,
        }))
      ).select('id, branch_id');
      (inserted || []).forEach((l: any) => { if (l.branch_id) locMap[l.branch_id] = l.id; });
    }

    setBranchToLocationMap(locMap);
  };

  const fetchMedicines = async () => {
    if (!profile?.id) return;
    const { data: branchData } = await supabase.from('pharmacy_branches').select('id').eq('pharmacy_owner_id', profile.id);
    const branchIds = (branchData || []).map((b: any) => b.id);
    if (branchIds.length === 0) return;

    // Source of truth: branch_items (id, quantity, prices) — needed for FIFO + cloning to destination
    const { data: bItems } = await supabase
      .from('branch_items')
      .select('id, medicine_id, branch_id, quantity, purchase_price, selling_price')
      .in('branch_id', branchIds);

    const medIds = [...new Set((bItems || []).map((b: any) => b.medicine_id))];
    if (medIds.length === 0) { setMedicines([]); return; }

    const { data: meds } = await supabase
      .from('medicines')
      .select('id, name')
      .in('id', medIds);

    const nameMap: Record<string, string> = {};
    (meds || []).forEach((m: any) => { nameMap[m.id] = m.name; });

    const rows = (bItems || [])
      .map((b: any) => ({
        id: b.medicine_id,
        name: nameMap[b.medicine_id] || 'Unknown',
        stock_quantity: Number(b.quantity || 0),
        branch_id: b.branch_id,
        branch_item_id: b.id,
        purchase_price: Number(b.purchase_price || 0),
        selling_price: Number(b.selling_price || 0),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    setMedicines(rows);
  };


  const availableMedicines = fromBranchId
    ? medicines.filter(m => m.branch_id === fromBranchId)
    : medicines;

  const selectedMedicine = medicines.find(m =>
    m.id === medicineId && (!fromBranchId || m.branch_id === fromBranchId)
  );

  const summary = useMemo(() => {
    if (!selectedMedicine || !quantity || Number(quantity) <= 0) return null;
    const qty = Number(quantity);
    const fromBranch = branches.find(b => b.id === fromBranchId);
    const toBranch = branches.find(b => b.id === toBranchId);
    const destMed = medicines.find(m =>
      m.id === selectedMedicine.id && m.branch_id === toBranchId
    );

    return {
      itemName: selectedMedicine.name,
      qty,
      sourceName: fromBranch?.name || '—',
      destName: toBranch?.name || '—',
      sourceBefore: selectedMedicine.stock_quantity,
      sourceAfter: (movementType === 'TRANSFER' || movementType === 'RETURN')
        ? selectedMedicine.stock_quantity - qty
        : selectedMedicine.stock_quantity,
      destBefore: destMed?.stock_quantity ?? 0,
      destAfter: (destMed?.stock_quantity ?? 0) + qty,
      isNewAtDest: !destMed,
    };
  }, [selectedMedicine, quantity, fromBranchId, toBranchId, movementType, medicines, branches]);

  const validateForm = () => {
    if (!medicineId || !quantity || Number(quantity) <= 0) {
      toast({ title: 'Error', description: 'Please fill all required fields', variant: 'destructive' });
      return false;
    }
    if (movementType === 'TRANSFER' && (!fromBranchId || !toBranchId)) {
      toast({ title: 'Error', description: 'Select both source and destination', variant: 'destructive' });
      return false;
    }
    if (fromBranchId === toBranchId && movementType === 'TRANSFER') {
      toast({ title: 'Error', description: 'Source and destination must be different', variant: 'destructive' });
      return false;
    }
    const qty = Number(quantity);
    if (selectedMedicine && qty > selectedMedicine.stock_quantity && (movementType === 'TRANSFER' || movementType === 'RETURN')) {
      toast({ title: 'Error', description: `Insufficient stock. Available: ${selectedMedicine.stock_quantity}`, variant: 'destructive' });
      return false;
    }
    return true;
  };

  const handleReview = () => {
    if (validateForm()) setShowConfirmation(true);
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;

    // Resolve branch IDs to location IDs for the FK
    const fromLocationId = fromBranchId ? branchToLocationMap[fromBranchId] : null;
    const toLocationId = toBranchId ? branchToLocationMap[toBranchId] : null;

    if (fromBranchId && !fromLocationId) {
      toast({ title: 'Error', description: 'Source branch has no location entry. Please reopen the form to sync.', variant: 'destructive' });
      return;
    }
    if (toBranchId && !toLocationId) {
      toast({ title: 'Error', description: 'Destination branch has no location entry. Please reopen the form to sync.', variant: 'destructive' });
      return;
    }

    const qty = Number(quantity);
    setSaving(true);
    try {
      const { error: moveError } = await supabase.from('stock_movements').insert({
        medicine_id: medicineId,
        from_location_id: fromLocationId,
        to_location_id: toLocationId,
        quantity: qty,
        movement_type: movementType,
        status: 'completed',
        notes: notes || null,
        created_by: user?.id,
      });
      if (moveError) throw moveError;

      // Track transferred cost for balanced expense accounting
      let transferredCost = 0;

      // === SOURCE: deduct via FIFO from oldest batches ===
      if (fromBranchId && (movementType === 'TRANSFER' || movementType === 'RETURN')) {
        if (selectedMedicine?.branch_item_id) {
          const { consumed, error: fifoErr } = await deductFIFO(selectedMedicine.branch_item_id, qty);
          if (fifoErr) {
            // No batches yet — direct branch_items quantity decrement as fallback
            const newQty = Math.max(0, (selectedMedicine.stock_quantity || 0) - qty);
            await supabase
              .from('branch_items')
              .update({ quantity: newQty, updated_at: new Date().toISOString() })
              .eq('id', selectedMedicine.branch_item_id);
            // Fallback cost basis: branch_items.purchase_price
            transferredCost = qty * Number(selectedMedicine.purchase_price || 0);
          } else {
            // Sum the FIFO consumed cost (per-batch purchase price)
            transferredCost = (consumed || []).reduce(
              (sum, c) => sum + Number(c.quantity) * Number(c.purchasePrice || 0),
              0
            );
            // If batches had no purchase price recorded, fallback to branch_items.purchase_price
            if (transferredCost === 0) {
              transferredCost = qty * Number(selectedMedicine.purchase_price || 0);
            }
          }
        }
      }

      // === DESTINATION: ensure branch_item exists, then create a batch for the incoming qty ===
      if (toBranchId && (movementType === 'TRANSFER' || movementType === 'SUPPLY')) {
        const pp = selectedMedicine?.purchase_price ?? 0;
        const sp = selectedMedicine?.selling_price ?? pp;

        // Find or create destination branch_item for this medicine
        const { data: existingDest } = await supabase
          .from('branch_items')
          .select('id')
          .eq('branch_id', toBranchId)
          .eq('medicine_id', medicineId)
          .maybeSingle();

        let destBranchItemId = (existingDest as any)?.id as string | undefined;

        if (!destBranchItemId) {
          const { data: created, error: createErr } = await supabase
            .from('branch_items')
            .insert({
              branch_id: toBranchId,
              medicine_id: medicineId,
              owner_id: profile?.id,
              quantity: 0,
              purchase_price: pp,
              selling_price: sp,
            })
            .select('id')
            .single();
          if (createErr) throw createErr;
          destBranchItemId = (created as any).id;
        }

        if (destBranchItemId) {
          const { error: batchErr } = await createBatch({
            branchId: toBranchId,
            medicineId,
            branchItemId: destBranchItemId,
            quantity: qty,
            purchasePrice: pp,
            sellingPrice: sp,
            createdBy: user?.id || null,
          });
          if (batchErr) {
            // Fallback: bump branch_items.quantity directly so stock still reflects the move
            const { data: current } = await supabase
              .from('branch_items')
              .select('quantity')
              .eq('id', destBranchItemId)
              .single();
            const next = Number((current as any)?.quantity || 0) + qty;
            await supabase
              .from('branch_items')
              .update({ quantity: next, updated_at: new Date().toISOString() })
              .eq('id', destBranchItemId);
          } else {
            await syncBranchItemQuantity(destBranchItemId);
          }
        }
      }

      // === FINANCIAL IMPACT: balanced expense entries between branches ===
      if (movementType === 'TRANSFER' && fromBranchId && toBranchId && transferredCost > 0) {
        const label = selectedMedicine?.name || 'Item';
        await supabase.from('expenses').insert([
          {
            description: `Stock Transfer Out: ${label} × ${qty}`,
            amount: -transferredCost,
            category: 'Stock Transfer',
            created_by: user?.id || null,
            branch_id: fromBranchId,
          },
          {
            description: `Stock Transfer In: ${label} × ${qty}`,
            amount: transferredCost,
            category: 'Stock Transfer',
            created_by: user?.id || null,
            branch_id: toBranchId,
          },
        ]);
      }

      // === RETURN: reduce expense in the source branch (goods leaving inventory, e.g. returned to supplier) ===
      if (movementType === 'RETURN' && fromBranchId && transferredCost > 0) {
        const label = selectedMedicine?.name || 'Item';
        await supabase.from('expenses').insert({
          description: `Stock Return: ${label} × ${qty}`,
          amount: -transferredCost,
          category: 'Stock Return',
          created_by: user?.id || null,
          branch_id: fromBranchId,
        });
      }

      toast({ title: 'Success', description: 'Stock moved between branches successfully' });
      window.dispatchEvent(new Event('app:refresh'));
      onSuccess?.();
      onOpenChange(false);
      resetForm();

    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Failed to record movement', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setFromBranchId(''); setToBranchId(''); setMedicineId('');
    setQuantity(''); setMovementType('TRANSFER'); setNotes('');
    setShowConfirmation(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Record Stock Movement</DialogTitle></DialogHeader>

        {showConfirmation && summary ? (
          <div className="space-y-4">
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="pt-4 space-y-3">
                <div className="flex items-center gap-2 font-semibold text-sm">
                  <Package className="h-4 w-4 text-primary" />
                  <span>{summary.itemName}</span>
                  <span className="ml-auto text-primary">× {summary.qty}</span>
                </div>

                {(movementType === 'TRANSFER' || movementType === 'RETURN') && (
                  <div className="rounded-md bg-background border p-3 space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">Source: {summary.sourceName}</p>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-mono">{summary.sourceBefore}</span>
                      <ArrowRight className="h-3 w-3 text-muted-foreground" />
                      <span className={`font-mono font-bold ${summary.sourceAfter <= 0 ? 'text-destructive' : 'text-foreground'}`}>
                        {summary.sourceAfter}
                      </span>
                    </div>
                  </div>
                )}

                {(movementType === 'TRANSFER' || movementType === 'SUPPLY') && (
                  <div className="rounded-md bg-background border p-3 space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">
                      Destination: {summary.destName}
                      {summary.isNewAtDest && <span className="ml-1 text-primary">(new)</span>}
                    </p>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-mono">{summary.destBefore}</span>
                      <ArrowRight className="h-3 w-3 text-muted-foreground" />
                      <span className="font-mono font-bold text-green-600">{summary.destAfter}</span>
                    </div>
                  </div>
                )}

                {notes && (
                  <p className="text-xs text-muted-foreground italic">Note: {notes}</p>
                )}
              </CardContent>
            </Card>

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setShowConfirmation(false)}>Back</Button>
              <Button onClick={handleSubmit} disabled={saving}>
                {saving ? 'Processing...' : 'Confirm & Record'}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <div className="space-y-4">
              <div>
                <Label>Movement Type</Label>
                <Select value={movementType} onValueChange={setMovementType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="TRANSFER">Transfer</SelectItem>
                    <SelectItem value="SUPPLY">Supply (Incoming)</SelectItem>
                    <SelectItem value="RETURN">Return</SelectItem>
                    <SelectItem value="ADJUSTMENT">Adjustment</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {(movementType === 'TRANSFER' || movementType === 'RETURN') && (
                <div>
                  <Label>From Branch *</Label>
                  <Select value={fromBranchId} onValueChange={(value) => { setFromBranchId(value); setMedicineId(''); setShowConfirmation(false); }}>
                    <SelectTrigger><SelectValue placeholder="Select source" /></SelectTrigger>
                    <SelectContent>
                      {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name} ({b.type})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {(movementType === 'TRANSFER' || movementType === 'SUPPLY') && (
                <div>
                  <Label>To Branch *</Label>
                  <Select value={toBranchId} onValueChange={setToBranchId}>
                    <SelectTrigger><SelectValue placeholder="Select destination" /></SelectTrigger>
                    <SelectContent>
                      {branches.filter(b => b.id !== fromBranchId).map(b => <SelectItem key={b.id} value={b.id}>{b.name} ({b.type})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div>
                <Label>Item *</Label>
                <Select value={medicineId} onValueChange={setMedicineId}>
                  <SelectTrigger><SelectValue placeholder="Select item" /></SelectTrigger>
                  <SelectContent>
                    {(fromBranchId ? availableMedicines : medicines).map(m => (
                      <SelectItem key={m.id} value={m.id}>{m.name} (Stock: {m.stock_quantity})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Quantity *</Label>
                <Input type="number" min="1" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="Enter quantity" />
                {selectedMedicine && <p className="text-xs text-muted-foreground mt-1">Available: {selectedMedicine.stock_quantity}</p>}
              </div>

              <div>
                <Label>Notes</Label>
                <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes..." rows={2} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={handleReview}>Review & Confirm</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}