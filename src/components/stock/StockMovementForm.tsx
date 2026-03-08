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
  const [locations, setLocations] = useState<{ id: string; name: string; type: string }[]>([]);
  const [medicines, setMedicines] = useState<{ id: string; name: string; stock_quantity: number; location_id?: string; branch_id?: string }[]>([]);
  const [fromLocationId, setFromLocationId] = useState('');
  const [toLocationId, setToLocationId] = useState('');
  const [medicineId, setMedicineId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [movementType, setMovementType] = useState('TRANSFER');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const { toast } = useToast();
  const { profile, user } = useAuth();

  useEffect(() => {
    if (open) { fetchLocations(); fetchMedicines(); setShowConfirmation(false); }
  }, [open]);

  const [locationBranchMap, setLocationBranchMap] = useState<Record<string, string>>({});

  const fetchLocations = async () => {
    if (!profile?.id) return;
    const { data } = await supabase.from('locations').select('id, name, type, branch_id').eq('pharmacy_owner_id', profile.id).order('name');
    setLocations(data || []);
    const map: Record<string, string> = {};
    (data || []).forEach((l: any) => { if (l.branch_id) map[l.id] = l.branch_id; });
    setLocationBranchMap(map);
  };

  const fetchMedicines = async () => {
    if (!profile?.id) return;
    const { data: branches } = await supabase.from('pharmacy_branches').select('id').eq('pharmacy_owner_id', profile.id);
    const branchIds = (branches || []).map((b: any) => b.id);
    if (branchIds.length === 0) return;
    const { data } = await supabase.from('medicines').select('id, name, stock_quantity, location_id, branch_id').in('branch_id', branchIds).order('name');
    setMedicines(data || []);
  };

  const availableMedicines = fromLocationId
    ? medicines.filter(m => {
        if (m.location_id === fromLocationId) return true;
        const linkedBranch = locationBranchMap[fromLocationId];
        return linkedBranch && m.branch_id === linkedBranch;
      })
    : medicines;

  const selectedMedicine = medicines.find(m => m.id === medicineId);

  // Compute confirmation summary
  const summary = useMemo(() => {
    if (!selectedMedicine || !quantity || Number(quantity) <= 0) return null;
    const qty = Number(quantity);
    const fromLoc = locations.find(l => l.id === fromLocationId);
    const toLoc = locations.find(l => l.id === toLocationId);
    const destBranchId = toLocationId ? locationBranchMap[toLocationId] : null;
    const destMed = medicines.find(m =>
      m.name === selectedMedicine.name && m.id !== selectedMedicine.id && (
        m.location_id === toLocationId ||
        (destBranchId && m.branch_id === destBranchId)
      )
    );

    return {
      itemName: selectedMedicine.name,
      qty,
      sourceName: fromLoc?.name || '—',
      destName: toLoc?.name || '—',
      sourceBefore: selectedMedicine.stock_quantity,
      sourceAfter: (movementType === 'TRANSFER' || movementType === 'RETURN')
        ? selectedMedicine.stock_quantity - qty
        : selectedMedicine.stock_quantity,
      destBefore: destMed?.stock_quantity ?? 0,
      destAfter: (destMed?.stock_quantity ?? 0) + qty,
      isNewAtDest: !destMed,
    };
  }, [selectedMedicine, quantity, fromLocationId, toLocationId, movementType, medicines, locations, locationBranchMap]);

  const validateForm = () => {
    if (!medicineId || !quantity || Number(quantity) <= 0) {
      toast({ title: 'Error', description: 'Please fill all required fields', variant: 'destructive' });
      return false;
    }
    if (movementType === 'TRANSFER' && (!fromLocationId || !toLocationId)) {
      toast({ title: 'Error', description: 'Select both source and destination', variant: 'destructive' });
      return false;
    }
    if (fromLocationId === toLocationId && movementType === 'TRANSFER') {
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

    const qty = Number(quantity);
    setSaving(true);
    try {
      const { error: moveError } = await supabase.from('stock_movements').insert({
        medicine_id: medicineId,
        from_location_id: fromLocationId || null,
        to_location_id: toLocationId || null,
        quantity: qty,
        movement_type: movementType,
        status: 'completed',
        notes: notes || null,
        created_by: user?.id,
      });
      if (moveError) throw moveError;

      if (fromLocationId && (movementType === 'TRANSFER' || movementType === 'RETURN')) {
        if (selectedMedicine) {
          await supabase.from('medicines').update({
            stock_quantity: selectedMedicine.stock_quantity - qty
          }).eq('id', selectedMedicine.id);
        }
      }

      if (toLocationId && (movementType === 'TRANSFER' || movementType === 'SUPPLY')) {
        const destBranchId = locationBranchMap[toLocationId] || null;
        const destMed = medicines.find(m =>
          m.name === selectedMedicine?.name && m.id !== selectedMedicine?.id && (
            m.location_id === toLocationId ||
            (destBranchId && m.branch_id === destBranchId)
          )
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
              location_id: toLocationId,
              branch_id: destBranchId,
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
    setFromLocationId(''); setToLocationId(''); setMedicineId('');
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
                  <Label>From Location *</Label>
                  <Select value={fromLocationId} onValueChange={setFromLocationId}>
                    <SelectTrigger><SelectValue placeholder="Select source" /></SelectTrigger>
                    <SelectContent>
                      {locations.map(l => <SelectItem key={l.id} value={l.id}>{l.name} ({l.type})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {(movementType === 'TRANSFER' || movementType === 'SUPPLY') && (
                <div>
                  <Label>To Location *</Label>
                  <Select value={toLocationId} onValueChange={setToLocationId}>
                    <SelectTrigger><SelectValue placeholder="Select destination" /></SelectTrigger>
                    <SelectContent>
                      {locations.filter(l => l.id !== fromLocationId).map(l => <SelectItem key={l.id} value={l.id}>{l.name} ({l.type})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div>
                <Label>Item *</Label>
                <Select value={medicineId} onValueChange={setMedicineId}>
                  <SelectTrigger><SelectValue placeholder="Select item" /></SelectTrigger>
                  <SelectContent>
                    {(fromLocationId ? availableMedicines : medicines).map(m => (
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
