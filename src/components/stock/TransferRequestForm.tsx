import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';

interface RequestItem {
  medicine_id: string;
  medicine_name: string;
  requested_quantity: number;
}

interface LocationOption {
  id: string;           // pharmacy_branch id
  name: string;
  type: string;
  branch_id?: string | null;
  location_id?: string | null;  // matching locations.id for FK
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export default function TransferRequestForm({ open, onOpenChange, onSuccess }: Props) {
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [medicines, setMedicines] = useState<{ id: string; name: string; stock_quantity: number }[]>([]);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [requestingLocationId, setRequestingLocationId] = useState('');
  const [sourceLocationId, setSourceLocationId] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<RequestItem[]>([]);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const { profile, user } = useAuth();

  useEffect(() => {
    if (open) { fetchLocations(); }
  }, [open]);

  const fetchLocations = async () => {
    if (!profile?.id) return;

    let resolvedOwnerId = profile.id;
    if (profile.role === 'staff' && profile.branch_id) {
      const { data: branch } = await supabase
        .from('pharmacy_branches')
        .select('pharmacy_owner_id')
        .eq('id', profile.branch_id)
        .maybeSingle();
      if (branch?.pharmacy_owner_id) resolvedOwnerId = branch.pharmacy_owner_id;
    }
    setOwnerId(resolvedOwnerId);

    // Fetch from both tables
    const [locationsRes, branchesRes] = await Promise.all([
      supabase.from('locations').select('id, name, type, branch_id').eq('pharmacy_owner_id', resolvedOwnerId).order('name'),
      supabase.from('pharmacy_branches').select('id, name, branch_type').eq('pharmacy_owner_id', resolvedOwnerId).order('name')
    ]);

    let locationRows: any[] = locationsRes.data || [];
    const branchRows: any[] = branchesRes.data || [];

    // Build a map: branch_id -> location_id
    const branchToLocationMap: Record<string, string> = {};
    locationRows.forEach((l) => {
      if (l.branch_id) branchToLocationMap[l.branch_id] = l.id;
    });

    // Legacy fallback: resolve by name/type when branch_id link is missing
    const normalize = (value: string) => value.trim().toLowerCase();
    const legacyByNameType: Record<string, string> = {};
    locationRows.forEach((l) => {
      if (!l.branch_id && l.name && l.type) {
        const key = `${normalize(l.name)}::${l.type}`;
        if (!legacyByNameType[key]) legacyByNameType[key] = l.id;
      }
    });

    const matchedLegacyLinks: { locationId: string; branchId: string }[] = [];
    branchRows.forEach((b) => {
      if (branchToLocationMap[b.id]) return;
      const expectedType = b.branch_type === 'pharmacy' ? 'pharmacy' : 'store';
      const legacyKey = `${normalize(b.name)}::${expectedType}`;
      const legacyLocationId = legacyByNameType[legacyKey];
      if (legacyLocationId) {
        branchToLocationMap[b.id] = legacyLocationId;
        matchedLegacyLinks.push({ locationId: legacyLocationId, branchId: b.id });
      }
    });

    // Persist recovered legacy links when owner opens the form
    if (matchedLegacyLinks.length > 0 && profile.role === 'owner') {
      await Promise.all(
        matchedLegacyLinks.map(({ locationId, branchId }) =>
          supabase.from('locations').update({ branch_id: branchId }).eq('id', locationId)
        )
      );
      locationRows = locationRows.map((l) => {
        const match = matchedLegacyLinks.find((m) => m.locationId === l.id);
        return match ? { ...l, branch_id: match.branchId } : l;
      });
    }

    // Auto-create missing location entries (best effort; may be blocked by RLS)
    const missingBranches = branchRows.filter((b) => !branchToLocationMap[b.id]);
    if (missingBranches.length > 0) {
      const { data: created } = await supabase
        .from('locations')
        .insert(missingBranches.map((b) => ({
          pharmacy_owner_id: resolvedOwnerId,
          name: b.name,
          type: b.branch_type === 'pharmacy' ? 'pharmacy' : 'store',
          branch_id: b.id,
        })))
        .select('id, name, type, branch_id');

      if (created) {
        created.forEach((l: any) => { branchToLocationMap[l.branch_id] = l.id; });
      }

      // Re-check in case rows existed but were not initially visible/linked
      const { data: refreshed } = await supabase
        .from('locations')
        .select('id, branch_id')
        .in('branch_id', missingBranches.map((b) => b.id));
      (refreshed || []).forEach((l: any) => {
        if (l.branch_id && !branchToLocationMap[l.branch_id]) branchToLocationMap[l.branch_id] = l.id;
      });
    }

    // Use pharmacy_branches for display, but track the location_id for FK submission
    const options: LocationOption[] = branchRows.map((b) => ({
      id: b.id,
      name: b.name,
      type: b.branch_type,
      branch_id: b.id,
      location_id: branchToLocationMap[b.id] || null,
    }));

    setLocations(options.sort((a, b) => a.name.localeCompare(b.name)));
  };

  const fetchMedicines = async (branchId?: string) => {
    if (!branchId) { setMedicines([]); return; }

    const { data } = await supabase
      .from('medicines')
      .select('id, name, stock_quantity')
      .eq('branch_id', branchId)
      .gt('stock_quantity', 0)
      .order('name');

    setMedicines(data || []);
  };

  // Re-fetch medicines when source branch changes
  useEffect(() => {
    if (sourceLocationId) {
      fetchMedicines(sourceLocationId);
      // Clear selected items when source changes
      setItems([]);
    } else {
      setMedicines([]);
    }
  }, [sourceLocationId, locations]);

  const addItem = () => {
    setItems(prev => [...prev, { medicine_id: '', medicine_name: '', requested_quantity: 1 }]);
  };

  const removeItem = (idx: number) => {
    setItems(prev => prev.filter((_, i) => i !== idx));
  };

  const updateItem = (idx: number, field: string, value: any) => {
    setItems(prev => prev.map((item, i) => {
      if (i !== idx) return item;
      if (field === 'medicine_id') {
        const med = medicines.find(m => m.id === value);
        return { ...item, medicine_id: value, medicine_name: med?.name || '' };
      }
      return { ...item, [field]: value };
    }));
  };

  const ensureLocationIdForBranch = async (branchId: string): Promise<string | null> => {
    if (!branchId) return null;

    const fromState = locations.find((l) => l.id === branchId)?.location_id;
    if (fromState) return fromState;

    const { data: existing } = await supabase
      .from('locations')
      .select('id')
      .eq('branch_id', branchId)
      .maybeSingle();

    if (existing?.id) {
      setLocations((prev) => prev.map((l) => (l.id === branchId ? { ...l, location_id: existing.id } : l)));
      return existing.id;
    }

    const branch = locations.find((l) => l.id === branchId);
    if (!branch || !ownerId) return null;

    const { data: created } = await supabase
      .from('locations')
      .insert({
        pharmacy_owner_id: ownerId,
        name: branch.name,
        type: branch.type === 'pharmacy' ? 'pharmacy' : 'store',
        branch_id: branchId,
      })
      .select('id')
      .maybeSingle();

    if (created?.id) {
      setLocations((prev) => prev.map((l) => (l.id === branchId ? { ...l, location_id: created.id } : l)));
      return created.id;
    }

    return null;
  };

  const handleSubmit = async () => {
    if (!requestingLocationId) { toast({ title: 'Error', description: 'Select requesting branch', variant: 'destructive' }); return; }
    if (items.length === 0) { toast({ title: 'Error', description: 'Add at least one item', variant: 'destructive' }); return; }
    const invalidItems = items.some(i => !i.medicine_id || i.requested_quantity <= 0);
    if (invalidItems) { toast({ title: 'Error', description: 'Fill all item fields properly', variant: 'destructive' }); return; }

    // Resolve locations.id for FK - transfer_requests references locations(id)
    const requestingBranch = locations.find(l => l.id === requestingLocationId);
    const sourceBranch = sourceLocationId ? locations.find(l => l.id === sourceLocationId) : null;

    const requestingLocId = requestingBranch?.location_id || await ensureLocationIdForBranch(requestingLocationId);
    const sourceLocId = sourceLocationId
      ? (sourceBranch?.location_id || await ensureLocationIdForBranch(sourceLocationId))
      : null;

    if (!requestingLocId) {
      toast({ title: 'Error', description: 'This branch is not linked to a location yet. Ask the owner to open Branches and save this branch once.', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const { data: req, error: reqError } = await supabase.from('transfer_requests').insert({
        requesting_location_id: requestingLocId,
        source_location_id: sourceLocId,
        notes: notes || null,
        created_by: user?.id,
      }).select().maybeSingle();
      if (reqError) throw reqError;
      if (!req?.id) {
        throw new Error('Transfer request could not be confirmed. Please refresh and try again.');
      }

      const { error: itemsError } = await supabase.from('transfer_request_items').insert(
        items.map(i => ({
          request_id: req.id,
          medicine_id: i.medicine_id,
          requested_quantity: i.requested_quantity,
        }))
      );
      if (itemsError) throw itemsError;

      toast({ title: 'Success', description: 'Transfer request submitted' });
      onSuccess?.();
      onOpenChange(false);
      resetForm();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Failed to submit request', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setRequestingLocationId(''); setSourceLocationId(''); setNotes(''); setItems([]);
  };

  const sourceBranches = locations.filter(l => l.id !== requestingLocationId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>New Transfer Request</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Requesting Branch *</Label>
            <Select value={requestingLocationId} onValueChange={setRequestingLocationId}>
              <SelectTrigger><SelectValue placeholder="Select your branch" /></SelectTrigger>
              <SelectContent>
                {locations.map(l => <SelectItem key={l.id} value={l.id}>{l.name} ({l.type})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Request From (Source Branch)</Label>
            <Select value={sourceLocationId || 'none'} onValueChange={v => setSourceLocationId(v === 'none' ? '' : v)}>
              <SelectTrigger><SelectValue placeholder="Select source branch" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— Not specified —</SelectItem>
                {sourceBranches.map(l => <SelectItem key={l.id} value={l.id}>{l.name} ({l.type})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Notes</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes..." rows={2} />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-base font-semibold">Items</Label>
              <Button type="button" size="sm" variant="outline" onClick={addItem}><Plus className="h-3 w-3 mr-1" />Add Item</Button>
            </div>
            {items.map((item, idx) => (
              <div key={idx} className="flex items-end gap-2 p-3 border rounded-md bg-muted/30">
                <div className="flex-1">
                  <Label className="text-xs">Item</Label>
                  <Select value={item.medicine_id} onValueChange={v => updateItem(idx, 'medicine_id', v)}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      {medicines.map(m => <SelectItem key={m.id} value={m.id}>{m.name} (Stock: {m.stock_quantity})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-24">
                  <Label className="text-xs">Qty</Label>
                  <Input type="number" min="1" value={item.requested_quantity} onChange={e => updateItem(idx, 'requested_quantity', Number(e.target.value))} />
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={() => removeItem(idx)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </div>
            ))}
            {items.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">{sourceLocationId ? 'Click "Add Item" to request items' : 'Select a source branch first to see available items'}</p>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving}>{saving ? 'Submitting...' : 'Submit Request'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
