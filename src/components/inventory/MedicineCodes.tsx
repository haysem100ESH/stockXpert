/**
 * MedicineCodes management page.
 * Lists owner-defined codes with linked medicine count + total combined stock.
 */
import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Plus, Edit, Trash2, ChevronDown, Tag, Search, Link2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { useMedicineCodes, type MedicineCode } from '@/hooks/useMedicineCodes';
import { useBranchInventory } from '@/hooks/useBranchInventory';
import { formatStock, defaultPackaging, type Packaging } from '@/lib/packaging';

interface LinkedMedicine {
  id: string;
  name: string;
  total_units: number;
  packaging: Packaging;
}

export default function MedicineCodes() {
  const { codes, loading, create, update, remove } = useMedicineCodes();
  const { items } = useBranchInventory();
  const { toast } = useToast();

  const [search, setSearch] = useState('');
  const [packagings, setPackagings] = useState<Record<string, Packaging>>({});

  const [editing, setEditing] = useState<MedicineCode | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<MedicineCode | null>(null);
  const [form, setForm] = useState({ code: '', label: '', notes: '' });
  const [busy, setBusy] = useState(false);

  // Assign items dialog state
  const [assignFor, setAssignFor] = useState<MedicineCode | null>(null);
  const [assignSearch, setAssignSearch] = useState('');
  const [assignSelection, setAssignSelection] = useState<Set<string>>(new Set());
  const [assignBusy, setAssignBusy] = useState(false);

  // Pull packaging rows for all medicines so we can format stock.
  useEffect(() => {
    const ids = [...new Set(items.map((i: any) => i.medicine_id))];
    if (ids.length === 0) return;
    (async () => {
      const { data } = await (supabase as any)
        .from('medicine_packaging')
        .select('medicine_id, unit_name, strip_enabled, units_per_strip, strip_name, pack_enabled, strips_per_pack, pack_name, unit_selling_price, strip_selling_price, pack_selling_price')
        .in('medicine_id', ids);
      const map: Record<string, Packaging> = {};
      (data || []).forEach((r: any) => { map[r.medicine_id] = r; });
      setPackagings(map);
    })();
  }, [items]);

  // Build per-code aggregates.
  const aggregates = useMemo(() => {
    const byCode = new Map<string, LinkedMedicine[]>();
    for (const it of items as any[]) {
      const codeId = it.medicine_code_id;
      if (!codeId) continue;
      const pk = packagings[it.medicine_id] || defaultPackaging();
      const link: LinkedMedicine = {
        id: it.medicine_id,
        name: it.name,
        total_units: it.quantity || 0,
        packaging: pk,
      };
      if (!byCode.has(codeId)) byCode.set(codeId, []);
      byCode.get(codeId)!.push(link);
    }
    return byCode;
  }, [items, packagings]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return codes;
    return codes.filter((c) =>
      c.code.toLowerCase().includes(q) || c.label.toLowerCase().includes(q),
    );
  }, [codes, search]);

  const openCreate = () => { setForm({ code: '', label: '', notes: '' }); setCreating(true); };
  const openEdit = (c: MedicineCode) => {
    setEditing(c);
    setForm({ code: c.code, label: c.label, notes: c.notes || '' });
  };

  const handleSubmit = async () => {
    if (!form.code.trim() || !form.label.trim()) {
      toast({ title: 'Code and label are required', variant: 'destructive' });
      return;
    }
    setBusy(true);
    try {
      if (editing) {
        await update(editing.id, form);
        toast({ title: 'Code updated' });
      } else {
        await create(form);
        toast({ title: 'Code created' });
      }
      setEditing(null); setCreating(false);
    } catch (e: any) {
      toast({ title: 'Failed', description: e?.message || 'Unknown error', variant: 'destructive' });
    } finally { setBusy(false); }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    try {
      await remove(confirmDelete.id);
      toast({ title: 'Code deleted', description: 'Linked medicines were unlinked but kept.' });
    } catch (e: any) {
      toast({ title: 'Failed', description: e?.message || 'Unknown error', variant: 'destructive' });
    } finally { setConfirmDelete(null); }
  };

  // ----- Assign items helpers -----
  const uniqueMedicines = useMemo(() => {
    const map = new Map<string, { medicine_id: string; name: string; code_id: string | null }>();
    for (const it of items as any[]) {
      if (!map.has(it.medicine_id)) {
        map.set(it.medicine_id, {
          medicine_id: it.medicine_id,
          name: it.name,
          code_id: it.medicine_code_id ?? null,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [items]);

  const codeById = useMemo(() => {
    const m = new Map<string, MedicineCode>();
    codes.forEach((c) => m.set(c.id, c));
    return m;
  }, [codes]);

  const filteredAssignMeds = useMemo(() => {
    const q = assignSearch.trim().toLowerCase();
    if (!q) return uniqueMedicines;
    return uniqueMedicines.filter((m) => m.name.toLowerCase().includes(q));
  }, [uniqueMedicines, assignSearch]);

  const openAssign = (c: MedicineCode) => {
    setAssignFor(c);
    setAssignSearch('');
    const preset = new Set<string>(
      uniqueMedicines.filter((m) => m.code_id === c.id).map((m) => m.medicine_id),
    );
    setAssignSelection(preset);
  };

  const toggleAssignItem = (medicineId: string) => {
    setAssignSelection((prev) => {
      const next = new Set(prev);
      if (next.has(medicineId)) next.delete(medicineId);
      else next.add(medicineId);
      return next;
    });
  };

  const handleAssign = async () => {
    if (!assignFor) return;
    setAssignBusy(true);
    try {
      const targetId = assignFor.id;
      const currentlyInThisCode = new Set(
        uniqueMedicines.filter((m) => m.code_id === targetId).map((m) => m.medicine_id),
      );
      const toAssign = [...assignSelection].filter((id) => !currentlyInThisCode.has(id));
      const toUnassign = [...currentlyInThisCode].filter((id) => !assignSelection.has(id));

      if (toAssign.length > 0) {
        const { error } = await (supabase as any)
          .from('medicines')
          .update({ medicine_code_id: targetId })
          .in('id', toAssign);
        if (error) throw error;
      }
      if (toUnassign.length > 0) {
        const { error } = await (supabase as any)
          .from('medicines')
          .update({ medicine_code_id: null })
          .in('id', toUnassign);
        if (error) throw error;
      }
      toast({
        title: 'Assignments updated',
        description: `${toAssign.length} added, ${toUnassign.length} removed.`,
      });
      setAssignFor(null);
      window.dispatchEvent(new Event('app:refresh'));
    } catch (e: any) {
      toast({ title: 'Failed', description: e?.message || 'Unknown error', variant: 'destructive' });
    } finally {
      setAssignBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2"><Tag className="h-6 w-6" />Medicine Codes</h2>
          <p className="text-sm text-muted-foreground">
            Group variants of the same drug under a single code to see combined stock.
          </p>
        </div>
        <Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" />New Code</Button>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search codes…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
      </div>

      {loading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No codes yet. Create one to start grouping medicine variants.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((c) => {
            const linked = aggregates.get(c.id) || [];
            const totalUnits = linked.reduce((s, l) => s + l.total_units, 0);
            // For combined display, use the first medicine's packaging as the basis.
            // Falls back to default if no medicines linked.
            const basis = linked[0]?.packaging || defaultPackaging();
            return (
              <Card key={c.id}>
                <Collapsible>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-3 min-w-0">
                        <Badge variant="outline" className="font-mono text-sm">{c.code}</Badge>
                        <div className="min-w-0">
                          <CardTitle className="text-base truncate">{c.label}</CardTitle>
                          {c.notes && <p className="text-xs text-muted-foreground mt-0.5">{c.notes}</p>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 sm:gap-2 flex-wrap justify-end">
                        <Badge variant="secondary">{linked.length} item{linked.length === 1 ? '' : 's'}</Badge>
                        <Badge>{formatStock(totalUnits, basis)}</Badge>
                        <Button variant="outline" size="sm" onClick={() => openAssign(c)} title="Assign items">
                          <Link2 className="h-4 w-4 sm:mr-1" />
                          <span className="hidden sm:inline">Assign</span>
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => openEdit(c)} title="Edit">
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => setConfirmDelete(c)} title="Delete">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                        <CollapsibleTrigger asChild>
                          <Button variant="ghost" size="icon" title="Show linked items">
                            <ChevronDown className="h-4 w-4" />
                          </Button>
                        </CollapsibleTrigger>
                      </div>
                    </div>
                  </CardHeader>
                  <CollapsibleContent>
                    <CardContent>
                      {linked.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No medicines linked to this code yet.</p>
                      ) : (
                        <div className="divide-y">
                          {linked.map((l) => (
                            <div key={l.id} className="flex items-center justify-between py-2 text-sm">
                              <span className="truncate">{l.name}</span>
                              <Badge variant="outline">{formatStock(l.total_units, l.packaging)}</Badge>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </CollapsibleContent>
                </Collapsible>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create / Edit dialog */}
      <Dialog open={creating || !!editing} onOpenChange={(v) => { if (!v) { setCreating(false); setEditing(null); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Code' : 'New Code'}</DialogTitle>
            <DialogDescription>
              Codes group medicines that are the same drug across batches, brands or manufacturers.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="code_code">Code *</Label>
              <Input id="code_code" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder="e.g. AMOX-500" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="code_label">Label *</Label>
              <Input id="code_label" value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} placeholder="e.g. Amoxicillin 500mg" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="code_notes">Notes</Label>
              <Textarea id="code_notes" rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreating(false); setEditing(null); }}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        open={!!confirmDelete}
        onOpenChange={(v) => !v && setConfirmDelete(null)}
        title="Delete code?"
        description={confirmDelete ? `Delete code "${confirmDelete.code}"? Linked medicines will be unlinked but not deleted.` : ''}
        onConfirm={handleDelete}
      />

      {/* Assign items dialog */}
      <Dialog open={!!assignFor} onOpenChange={(v) => { if (!v) setAssignFor(null); }}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Assign Items</DialogTitle>
            <DialogDescription>
              {assignFor ? (
                <>Select medicines to group under <span className="font-mono">{assignFor.code}</span> — {assignFor.label}. Items already in another group appear faded; selecting one will move it to this group.</>
              ) : null}
            </DialogDescription>
          </DialogHeader>

          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search items…"
              value={assignSearch}
              onChange={(e) => setAssignSearch(e.target.value)}
              className="pl-8"
            />
          </div>

          <ScrollArea className="flex-1 min-h-[240px] max-h-[50vh] border rounded-md">
            {filteredAssignMeds.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                No items in this branch.
              </div>
            ) : (
              <div className="divide-y">
                {filteredAssignMeds.map((m) => {
                  const checked = assignSelection.has(m.medicine_id);
                  const otherCode = m.code_id && m.code_id !== assignFor?.id ? codeById.get(m.code_id) : null;
                  return (
                    <label
                      key={m.medicine_id}
                      htmlFor={`assign-${m.medicine_id}`}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-accent/40 transition-colors',
                        otherCode && !checked && 'opacity-50',
                      )}
                    >
                      <Checkbox
                        id={`assign-${m.medicine_id}`}
                        checked={checked}
                        onCheckedChange={() => toggleAssignItem(m.medicine_id)}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm truncate">{m.name}</div>
                        {otherCode && (
                          <div className="text-xs text-muted-foreground truncate">
                            In group: <span className="font-mono">{otherCode.code}</span> · {otherCode.label}
                          </div>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </ScrollArea>

          <div className="text-xs text-muted-foreground">
            {assignSelection.size} selected
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignFor(null)}>Cancel</Button>
            <Button onClick={handleAssign} disabled={assignBusy}>
              {assignBusy ? 'Saving…' : 'Save assignments'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
