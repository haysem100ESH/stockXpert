import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Plus, Edit, Trash2, Warehouse, Store, Building2, MapPin, Phone, Link2 } from 'lucide-react';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';

interface Location {
  id: string;
  pharmacy_owner_id: string;
  name: string;
  type: 'warehouse' | 'pharmacy' | 'store';
  address?: string;
  phone?: string;
  branch_id?: string;
  branch_name?: string;
  created_at: string;
}

export default function LocationManagement() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: '', type: 'warehouse' as string, address: '', phone: '', branch_id: '' });
  const { toast } = useToast();
  const { profile } = useAuth();

  useEffect(() => { fetchLocations(); fetchBranches(); }, []);

  const fetchBranches = async () => {
    if (!profile?.id) return;
    const { data } = await supabase
      .from('pharmacy_branches')
      .select('id, name')
      .eq('pharmacy_owner_id', profile.id);
    setBranches(data || []);
  };

  const fetchLocations = async () => {
    if (!profile?.id) return;
    try {
      const { data, error } = await supabase
        .from('locations')
        .select('*')
        .eq('pharmacy_owner_id', profile.id)
        .order('created_at');
      if (error) throw error;

      // Fetch branch names
      const branchIds = (data || []).map(l => l.branch_id).filter(Boolean);
      const branchMap: Record<string, string> = {};
      if (branchIds.length > 0) {
        const { data: bData } = await supabase.from('pharmacy_branches').select('id, name').in('id', branchIds);
        (bData || []).forEach((b: any) => { branchMap[b.id] = b.name; });
      }

      setLocations((data || []).map(l => ({ ...l, branch_name: l.branch_id ? branchMap[l.branch_id] : undefined })));
    } catch {
      toast({ title: 'Error', description: 'Failed to fetch locations', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const openCreate = () => {
    setEditingLocation(null);
    setFormData({ name: '', type: 'warehouse', address: '', phone: '', branch_id: '' });
    setShowDialog(true);
  };

  const openEdit = (loc: Location) => {
    setEditingLocation(loc);
    setFormData({ name: loc.name, type: loc.type, address: loc.address || '', phone: loc.phone || '', branch_id: loc.branch_id || '' });
    setShowDialog(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim()) { toast({ title: 'Error', description: 'Name is required', variant: 'destructive' }); return; }
    try {
      const payload: any = {
        name: formData.name.trim(),
        type: formData.type,
        address: formData.address || null,
        phone: formData.phone || null,
        branch_id: formData.branch_id || null,
        pharmacy_owner_id: profile!.id,
      };
      if (editingLocation) {
        const { error } = await supabase.from('locations').update(payload).eq('id', editingLocation.id);
        if (error) throw error;
        toast({ title: 'Success', description: 'Location updated' });
      } else {
        const { error } = await supabase.from('locations').insert(payload);
        if (error) throw error;
        toast({ title: 'Success', description: 'Location created' });
      }
      setShowDialog(false);
      fetchLocations();
    } catch {
      toast({ title: 'Error', description: 'Failed to save location', variant: 'destructive' });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const { error } = await supabase.from('locations').delete().eq('id', deleteTarget);
      if (error) throw error;
      toast({ title: 'Success', description: 'Location deleted' });
      fetchLocations();
    } catch {
      toast({ title: 'Error', description: 'Failed to delete location', variant: 'destructive' });
    } finally {
      setDeleteTarget(null);
    }
  };

  const typeIcon = (type: string) => {
    if (type === 'warehouse') return <Warehouse className="h-5 w-5 text-primary" />;
    if (type === 'pharmacy') return <Building2 className="h-5 w-5 text-info" />;
    return <Store className="h-5 w-5 text-warning" />;
  };

  const typeBadgeVariant = (type: string) => {
    if (type === 'warehouse') return 'default';
    if (type === 'pharmacy') return 'secondary';
    return 'outline';
  };

  if (loading) return <div>Loading locations...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Location Management</h2>
        <Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" />Add Location</Button>
      </div>

      {locations.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Warehouse className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p className="text-lg font-medium mb-2">No locations yet</p>
            <p className="mb-4">Create your first warehouse, pharmacy, or store location to start managing multi-location inventory.</p>
            <Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" />Create First Location</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {locations.map(loc => (
            <Card key={loc.id} className="relative">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    {typeIcon(loc.type)}
                    <CardTitle className="text-lg">{loc.name}</CardTitle>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(loc)}><Edit className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(loc.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <Badge variant={typeBadgeVariant(loc.type) as any} className="capitalize">{loc.type}</Badge>
                {loc.address && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <MapPin className="h-3 w-3" /><span>{loc.address}</span>
                  </div>
                )}
                {loc.phone && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Phone className="h-3 w-3" /><span>{loc.phone}</span>
                  </div>
                )}
                {loc.branch_name && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Link2 className="h-3 w-3" /><span>Linked: {loc.branch_name}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingLocation ? 'Edit Location' : 'Create Location'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div><Label>Name *</Label><Input value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Main Warehouse" /></div>
            <div><Label>Type *</Label>
              <Select value={formData.type} onValueChange={v => setFormData(p => ({ ...p, type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="warehouse">Warehouse</SelectItem>
                  <SelectItem value="pharmacy">Pharmacy</SelectItem>
                  <SelectItem value="store">Store</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Address</Label><Input value={formData.address} onChange={e => setFormData(p => ({ ...p, address: e.target.value }))} placeholder="Optional" /></div>
            <div><Label>Phone</Label><Input value={formData.phone} onChange={e => setFormData(p => ({ ...p, phone: e.target.value }))} placeholder="Optional" /></div>
            <div><Label>Link to Branch (optional)</Label>
              <Select value={formData.branch_id || 'none'} onValueChange={v => setFormData(p => ({ ...p, branch_id: v === 'none' ? '' : v }))}>
                <SelectTrigger><SelectValue placeholder="No branch linked" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No branch linked</SelectItem>
                  {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button onClick={handleSave}>{editingLocation ? 'Update' : 'Create'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        open={!!deleteTarget}
        onOpenChange={() => setDeleteTarget(null)}
        title="Delete Location"
        description="Are you sure? This will remove the location. Any stock linked to it should be moved first."
        onConfirm={handleDelete}
        confirmText="Delete"
      />
    </div>
  );
}
