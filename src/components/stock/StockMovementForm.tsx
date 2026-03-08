import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
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
  const { toast } = useToast();
  const { profile, user } = useAuth();

  useEffect(() => {
    if (open) { fetchLocations(); fetchMedicines(); }
  }, [open]);

  // Build a map of location_id -> branch_id for filtering
  const [locationBranchMap, setLocationBranchMap] = useState<Record<string, string>>({});

  const fetchLocations = async () => {
    if (!profile?.id) return;
    const { data } = await supabase.from('locations').select('id, name, type, branch_id').eq('pharmacy_owner_id', profile.id).order('name');
    setLocations(data || []);
    // Build location->branch map
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

  // Filter medicines based on selected source location
  // Match by location_id directly OR by branch_id linked to the location
  const availableMedicines = fromLocationId
    ? medicines.filter(m => {
        if (m.location_id === fromLocationId) return true;
        const linkedBranch = locationBranchMap[fromLocationId];
        return linkedBranch && m.branch_id === linkedBranch;
      })
    : medicines;

  const selectedMedicine = medicines.find(m => m.id === medicineId);

  const handleSubmit = async () => {
    if (!medicineId || !quantity || Number(quantity) <= 0) {
      toast({ title: 'Error', description: 'Please fill all required fields', variant: 'destructive' });
      return;
    }
    if (movementType === 'TRANSFER' && (!fromLocationId || !toLocationId)) {
      toast({ title: 'Error', description: 'Select both source and destination', variant: 'destructive' });
      return;
    }
    if (fromLocationId === toLocationId && movementType === 'TRANSFER') {
      toast({ title: 'Error', description: 'Source and destination must be different', variant: 'destructive' });
      return;
    }

    const qty = Number(quantity);
    if (selectedMedicine && qty > selectedMedicine.stock_quantity && (movementType === 'TRANSFER' || movementType === 'RETURN')) {
      toast({ title: 'Error', description: `Insufficient stock. Available: ${selectedMedicine.stock_quantity}`, variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      // Create stock movement record
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

      // Adjust stock: deduct from source
      if (fromLocationId && (movementType === 'TRANSFER' || movementType === 'RETURN')) {
        // Find the medicine at source location
        const sourceMed = medicines.find(m => m.id === medicineId && m.location_id === fromLocationId);
        if (sourceMed) {
          await supabase.from('medicines').update({
            stock_quantity: sourceMed.stock_quantity - qty
          }).eq('id', sourceMed.id);
        }
      }

      // For TRANSFER/SUPPLY: check if medicine exists at destination, otherwise create it
      if (toLocationId && (movementType === 'TRANSFER' || movementType === 'SUPPLY')) {
        const destMed = medicines.find(m => m.name === selectedMedicine?.name && m.location_id === toLocationId);
        if (destMed) {
          await supabase.from('medicines').update({
            stock_quantity: destMed.stock_quantity + qty
          }).eq('id', destMed.id);
        } else if (selectedMedicine) {
          // Get the branch_id for the destination location
          const destLoc = locations.find(l => l.id === toLocationId);
          let destBranchId = null;
          if (destLoc) {
            const { data: locData } = await supabase.from('locations').select('branch_id').eq('id', toLocationId).single();
            destBranchId = locData?.branch_id;
          }
          // Clone the medicine to the destination
          const { id, stock_quantity, location_id, branch_id, ...rest } = selectedMedicine as any;
          await supabase.from('medicines').insert({
            ...rest,
            stock_quantity: qty,
            location_id: toLocationId,
            branch_id: destBranchId,
            created_by: user?.id,
          });
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
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Record Stock Movement</DialogTitle></DialogHeader>
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
          <Button onClick={handleSubmit} disabled={saving}>{saving ? 'Processing...' : 'Record Movement'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
