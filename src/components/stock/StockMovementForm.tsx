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

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export default function StockMovementForm({ open, onOpenChange, onSuccess }: Props) {
  const [branches, setBranches] = useState<{ id: string; name: string; type: string }[]>([]);
  const [branchToLocationMap, setBranchToLocationMap] = useState<Record<string, string>>({});
  const [medicines, setMedicines] = useState<{ id: string; name: string; stock_quantity: number; branch_id?: string }[]>([]);
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

    // Source of truth: branch_items.quantity (kept in sync by fulfill/sale RPCs)
    const { data: bItems } = await supabase
      .from('branch_items')
      .select('medicine_id, branch_id, quantity')
      .in('branch_id', branchIds);

    const medIds = [...new Set((bItems || []).map((b: any) => b.medicine_id))];
    if (medIds.length === 0) { setMedicines([]); return; }

    const { data: meds } = await supabase
      .from('medicines')
      .select('id, name')
      .in('id', medIds);

    const nameMap: Record<string, string> = {};
    (meds || []).forEach((m: any) => { nameMap[m.id] = m.name; });

    // Build one virtual row per (medicine_id, branch_id) using branch_items.quantity
    const rows = (bItems || [])
      .map((b: any) => ({
        id: b.medicine_id,
        name: nameMap[b.medicine_id] || 'Unknown',
        stock_quantity: Number(b.quantity || 0),
        branch_id: b.branch_id,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    setMedicines(rows);
  };

  const availableMedicines = fromBranchId
    ? medicines.filter(m => m.branch_id === fromBranchId)
    : medicines;

  const selectedMedicine = medicines.find(m => m.id === medicineId);

  const summary = useMemo(() => {
    if (!selectedMedicine || !quantity || Number(quantity) <= 0) return null;
    const qty = Number(quantity);
    const fromBranch = branches.find(b => b.id === fromBranchId);
    const toBranch = branches.find(b => b.id === toBranchId);
    const destMed = medicines.find(m =>
      m.name === selectedMedicine.name && m.id !== selectedMedicine.id && m.branch_id === toBranchId
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

      if (fromBranchId && (movementType === 'TRANSFER' || movementType === 'RETURN')) {
        if (selectedMedicine) {
          await supabase.from('medicines').update({
            stock_quantity: selectedMedicine.stock_quantity - qty
          }).eq('id', selectedMedicine.id);
        }
      }

      if (toBranchId && (movementType === 'TRANSFER' || movementType === 'SUPPLY')) {
        const destMed = medicines.find(m =>
          m.name === selectedMedicine?.name && m.id !== selectedMedicine?.id && m.branch_id === toBranchId
        );

        if (destMed) {
          await supabase.from('medicines').update({
            stock_quantity: destMed.stock_quantity + qty
          }).eq('id', destMed.id);
        } else if (selectedMedicine) {
          const { data: fullMed } = await supabase.from('medicines').select('*').eq('id', selectedMedicine.id).single();
          if (fullMed) {
            const { id, stock_quantity, location_id, branch_id, created_at, updated_at, ...rest } = fullMed as any;
            await supabase.from('medicines').insert({
              ...rest,
              stock_quantity: qty,
              branch_id: toBranchId,
              created_by: user?.id,
            });
          }
        }
      }

      toast({ title: 'Success', description: 'Stock movement recorded successfully' });
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
                  <Select value={fromBranchId} onValueChange={setFromBranchId}>
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