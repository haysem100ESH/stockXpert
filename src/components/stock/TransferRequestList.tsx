import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ClipboardList, Plus, Check, X, Package } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import TransferRequestForm from './TransferRequestForm';

interface RequestRow {
  id: string;
  requesting_location: string;
  source_location: string;
  status: string;
  notes?: string;
  created_by_name?: string;
  approved_by_name?: string;
  items: { medicine_name: string; requested_quantity: number; approved_quantity: number }[];
  created_at: string;
}

export default function TransferRequestList() {
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const { toast } = useToast();
  const { profile, user } = useAuth();
  const isOwner = profile?.role === 'owner';

  useEffect(() => { fetchRequests(); }, [statusFilter]);

  const fetchRequests = async () => {
    try {
      let query = supabase.from('transfer_requests').select('*').order('created_at', { ascending: false });
      if (statusFilter !== 'all') query = query.eq('status', statusFilter);
      const { data, error } = await query;
      if (error) throw error;

      if (!data || data.length === 0) { setRequests([]); setLoading(false); return; }

      const reqIds = data.map(r => r.id);
      const locIds = [...new Set(data.flatMap(r => [r.requesting_location_id, r.source_location_id]).filter(Boolean))];
      const userIds = [...new Set(data.flatMap(r => [r.created_by, r.approved_by]).filter(Boolean))];

      const [itemsRes, locationsRes, branchesRes, usersRes] = await Promise.all([
        supabase.from('transfer_request_items').select('*').in('request_id', reqIds),
        locIds.length ? supabase.from('locations').select('id, name').in('id', locIds) : { data: [] },
        locIds.length ? supabase.from('pharmacy_branches').select('id, name').in('id', locIds) : { data: [] },
        userIds.length ? supabase.from('profiles').select('id, full_name').in('id', userIds) : { data: [] },
      ]);

      const locMap: Record<string, string> = {};
      (locationsRes.data || []).forEach((l: any) => { locMap[l.id] = l.name; });
      (branchesRes.data || []).forEach((b: any) => { if (!locMap[b.id]) locMap[b.id] = b.name; });
      const userMap: Record<string, string> = {};
      (usersRes.data || []).forEach((u: any) => { userMap[u.id] = u.full_name; });

      // Fetch medicine names for items
      const medIds = [...new Set((itemsRes.data || []).map((i: any) => i.medicine_id))];
      const medsRes = medIds.length ? await supabase.from('medicines').select('id, name').in('id', medIds) : { data: [] };
      const medMap: Record<string, string> = {};
      (medsRes.data || []).forEach((m: any) => { medMap[m.id] = m.name; });

      setRequests(data.map(r => ({
        id: r.id,
        requesting_location: locMap[r.requesting_location_id] || 'Unknown',
        source_location: r.source_location_id ? locMap[r.source_location_id] || 'Unknown' : 'Auto',
        status: r.status,
        notes: r.notes,
        created_by_name: r.created_by ? userMap[r.created_by] : undefined,
        approved_by_name: r.approved_by ? userMap[r.approved_by] : undefined,
        items: (itemsRes.data || []).filter((i: any) => i.request_id === r.id).map((i: any) => ({
          medicine_name: medMap[i.medicine_id] || 'Unknown',
          requested_quantity: i.requested_quantity,
          approved_quantity: i.approved_quantity || 0,
        })),
        created_at: r.created_at,
      })));
    } catch {
      toast({ title: 'Error', description: 'Failed to fetch requests', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateStatus = async (requestId: string, newStatus: 'approved' | 'rejected') => {
    try {
      const { error } = await supabase.from('transfer_requests').update({
        status: newStatus,
        approved_by: user?.id,
        updated_at: new Date().toISOString(),
      }).eq('id', requestId);
      if (error) throw error;

      // If approved, update approved_quantity to match requested_quantity
      if (newStatus === 'approved') {
        const { data: items } = await supabase.from('transfer_request_items').select('*').eq('request_id', requestId);
        if (items) {
          for (const item of items) {
            await supabase.from('transfer_request_items').update({
              approved_quantity: item.requested_quantity
            }).eq('id', item.id);
          }
        }
      }

      toast({ title: 'Success', description: `Request ${newStatus}` });
      fetchRequests();
    } catch {
      toast({ title: 'Error', description: 'Failed to update request', variant: 'destructive' });
    }
  };

  const handleFulfill = async (request: RequestRow) => {
    try {
      // 1. Fetch the full transfer request with location IDs
      const { data: trReq, error: trErr } = await supabase
        .from('transfer_requests')
        .select('id, requesting_location_id, source_location_id')
        .eq('id', request.id)
        .single();
      if (trErr || !trReq) throw trErr || new Error('Request not found');

      // 2. Resolve location IDs to branch IDs
      const locIds = [trReq.requesting_location_id, trReq.source_location_id].filter(Boolean);
      const { data: locs } = await supabase.from('locations').select('id, branch_id').in('id', locIds);
      const locToBranch: Record<string, string> = {};
      (locs || []).forEach((l: any) => { if (l.branch_id) locToBranch[l.id] = l.branch_id; });

      const destBranchId = locToBranch[trReq.requesting_location_id];
      const sourceBranchId = trReq.source_location_id ? locToBranch[trReq.source_location_id] : null;

      if (!destBranchId) throw new Error('Could not resolve destination branch');
      if (!sourceBranchId) throw new Error('Could not resolve source branch');

      // 3. Fetch approved items
      const { data: items, error: itemsErr } = await supabase
        .from('transfer_request_items')
        .select('id, medicine_id, approved_quantity')
        .eq('request_id', request.id);
      if (itemsErr) throw itemsErr;
      if (!items || items.length === 0) throw new Error('No items to fulfill');

      // 4. Process each item: move stock + expenses
      for (const item of items) {
        const qty = Number(item.approved_quantity);
        if (qty <= 0) continue;

        // Get source medicine
        const { data: sourceMed } = await supabase
          .from('medicines')
          .select('*')
          .eq('id', item.medicine_id)
          .single();
        if (!sourceMed) continue;

        // Deduct from source
        await supabase.from('medicines').update({
          stock_quantity: Math.max(0, sourceMed.stock_quantity - qty),
        }).eq('id', sourceMed.id);

        // Add to destination - find existing or clone
        const { data: destMed } = await supabase
          .from('medicines')
          .select('*')
          .eq('branch_id', destBranchId)
          .eq('name', sourceMed.name)
          .maybeSingle();

        if (destMed) {
          await supabase.from('medicines').update({
            stock_quantity: destMed.stock_quantity + qty,
          }).eq('id', destMed.id);
        } else {
          // Clone medicine to destination branch
          const { id, stock_quantity, location_id, branch_id, created_at, updated_at, ...rest } = sourceMed as any;
          await supabase.from('medicines').insert({
            ...rest,
            stock_quantity: qty,
            branch_id: destBranchId,
            created_by: user?.id,
          });
        }

        // 5. Transfer expenses: deduct from source, add to destination
        const expenseAmount = qty * (sourceMed.purchase_price || 0);
        if (expenseAmount > 0) {
          const unitLabel = (sourceMed.unit_label || 'unit').toUpperCase();
          await supabase.from('expenses').insert([
            {
              description: `Transfer Out: ${sourceMed.name} (${qty} ${unitLabel}) to ${request.requesting_location}`,
              amount: -expenseAmount,
              branch_id: sourceBranchId,
              category: 'Stock Transfer',
              pharmacy_owner_id: profile?.id,
            },
            {
              description: `Transfer In: ${sourceMed.name} (${qty} ${unitLabel}) from ${request.source_location}`,
              amount: expenseAmount,
              branch_id: destBranchId,
              category: 'Stock Transfer',
              pharmacy_owner_id: profile?.id,
            },
          ]);
        }
      }

      // 6. Mark as fulfilled
      const { error } = await supabase.from('transfer_requests').update({
        status: 'fulfilled',
        updated_at: new Date().toISOString(),
      }).eq('id', request.id);
      if (error) throw error;

      toast({ title: 'Success', description: 'Transfer fulfilled — stock and expenses updated' });
      fetchRequests();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Failed to fulfill request', variant: 'destructive' });
    }
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case 'pending': return <Badge variant="outline" className="bg-yellow-50 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400">Pending</Badge>;
      case 'approved': return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">Approved</Badge>;
      case 'rejected': return <Badge variant="destructive">Rejected</Badge>;
      case 'fulfilled': return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">Fulfilled</Badge>;
      default: return <Badge>{status}</Badge>;
    }
  };

  if (loading) return <div>Loading transfer requests...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h2 className="text-2xl font-bold">Transfer Requests</h2>
        <div className="flex items-center gap-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="fulfilled">Fulfilled</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => setShowForm(true)}><Plus className="h-4 w-4 mr-2" />New Request</Button>
        </div>
      </div>

      {requests.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <ClipboardList className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p className="text-lg font-medium mb-2">No transfer requests</p>
            <p>Create a request to transfer stock from a warehouse to your branch.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {requests.map(req => (
            <Card key={req.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between flex-wrap gap-3 mb-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      {statusBadge(req.status)}
                      <span className="text-sm text-muted-foreground">{format(new Date(req.created_at), 'MMM dd, yyyy HH:mm')}</span>
                    </div>
                    <p className="text-sm"><strong>From:</strong> {req.source_location} → <strong>To:</strong> {req.requesting_location}</p>
                    {req.created_by_name && <p className="text-xs text-muted-foreground">By: {req.created_by_name}</p>}
                    {req.notes && <p className="text-xs text-muted-foreground mt-1">{req.notes}</p>}
                  </div>
                  {isOwner && req.status === 'pending' && (
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => handleUpdateStatus(req.id, 'approved')}>
                        <Check className="h-3 w-3 mr-1" />Approve
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => handleUpdateStatus(req.id, 'rejected')}>
                        <X className="h-3 w-3 mr-1" />Reject
                      </Button>
                    </div>
                  )}
                  {isOwner && req.status === 'approved' && (
                    <Button size="sm" onClick={() => handleFulfill(req)}>
                      <Package className="h-3 w-3 mr-1" />Fulfill
                    </Button>
                  )}
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead>Requested</TableHead>
                      <TableHead>Approved</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {req.items.map((item, idx) => (
                      <TableRow key={idx}>
                        <TableCell>{item.medicine_name}</TableCell>
                        <TableCell>{item.requested_quantity}</TableCell>
                        <TableCell>{item.approved_quantity}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <TransferRequestForm open={showForm} onOpenChange={setShowForm} onSuccess={fetchRequests} />
    </div>
  );
}
