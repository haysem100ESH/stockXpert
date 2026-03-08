import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Calendar, CheckCircle2, Clock, XCircle, Users } from 'lucide-react';
import { supabase } from '@/lib/db';
import { useAuth } from '@/hooks/useAuth';

interface AttendanceRecord {
  id: string;
  staff_id: string;
  branch_id: string;
  date: string;
  checkin_time: string | null;
  checkout_time: string | null;
  attendance_status: string;
  staff_name?: string;
  branch_name?: string;
}

interface StaffOption { id: string; full_name: string; }
interface BranchOption { id: string; name: string; }

export default function AttendanceDashboard() {
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [staffList, setStaffList] = useState<StaffOption[]>([]);
  const [filterBranch, setFilterBranch] = useState<string>('all');
  const [filterStaff, setFilterStaff] = useState<string>('all');
  const [filterDateFrom, setFilterDateFrom] = useState<string>('');
  const [filterDateTo, setFilterDateTo] = useState<string>('');
  const { profile, user } = useAuth();
  const isOwner = profile?.role === 'owner';

  useEffect(() => {
    // Default to current month
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const today = now.toISOString().split('T')[0];
    setFilterDateFrom(firstDay);
    setFilterDateTo(today);

    if (isOwner) fetchBranchesAndStaff();
  }, [profile]);

  useEffect(() => {
    if (filterDateFrom && filterDateTo) fetchRecords();
  }, [filterBranch, filterStaff, filterDateFrom, filterDateTo]);

  const fetchBranchesAndStaff = async () => {
    if (!profile?.id) return;
    const [branchRes, staffRes] = await Promise.all([
      supabase.from('pharmacy_branches').select('id, name').eq('pharmacy_owner_id', profile.id).order('name'),
      supabase.from('profiles').select('id, full_name').eq('role', 'staff'),
    ]);
    setBranches(branchRes.data || []);
    setStaffList(staffRes.data || []);
  };

  const fetchRecords = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('staff_attendance')
        .select('*')
        .gte('date', filterDateFrom)
        .lte('date', filterDateTo)
        .order('date', { ascending: false });

      if (!isOwner && user?.id) {
        query = query.eq('staff_id', user.id);
      }
      if (filterBranch !== 'all') query = query.eq('branch_id', filterBranch);
      if (filterStaff !== 'all') query = query.eq('staff_id', filterStaff);

      const { data, error } = await query;
      if (error) throw error;

      // Enrich with names
      const staffIds = [...new Set((data || []).map((r: any) => r.staff_id))];
      const branchIds = [...new Set((data || []).map((r: any) => r.branch_id))];

      const [staffRes, branchRes] = await Promise.all([
        staffIds.length ? supabase.from('profiles').select('id, full_name').in('id', staffIds) : { data: [] },
        branchIds.length ? supabase.from('pharmacy_branches').select('id, name').in('id', branchIds) : { data: [] },
      ]);

      const staffMap: Record<string, string> = {};
      (staffRes.data || []).forEach((s: any) => { staffMap[s.id] = s.full_name; });
      const branchMap: Record<string, string> = {};
      (branchRes.data || []).forEach((b: any) => { branchMap[b.id] = b.name; });

      const enriched = (data || []).map((r: any) => ({
        ...r,
        staff_name: staffMap[r.staff_id] || 'Unknown',
        branch_name: branchMap[r.branch_id] || 'Unknown',
      }));

      setRecords(enriched);
    } catch (error) {
      console.error('Failed to fetch attendance:', error);
    } finally {
      setLoading(false);
    }
  };

  // Monthly summary stats
  const presentCount = records.filter((r) => r.attendance_status === 'present').length;
  const lateCount = records.filter((r) => r.attendance_status === 'late').length;
  const absentCount = records.filter((r) => r.attendance_status === 'absent').length;

  const statusBadge = (status: string) => {
    switch (status) {
      case 'present': return <Badge variant="default">Present</Badge>;
      case 'late': return <Badge variant="secondary">Late</Badge>;
      case 'absent': return <Badge variant="destructive">Absent</Badge>;
      default: return <Badge>{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-8 w-8 text-green-600" />
              <div>
                <p className="text-2xl font-bold">{presentCount}</p>
                <p className="text-sm text-muted-foreground">Present Days</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Clock className="h-8 w-8 text-yellow-600" />
              <div>
                <p className="text-2xl font-bold">{lateCount}</p>
                <p className="text-sm text-muted-foreground">Late Days</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <XCircle className="h-8 w-8 text-destructive" />
              <div>
                <p className="text-2xl font-bold">{absentCount}</p>
                <p className="text-sm text-muted-foreground">Absent Days</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label>From Date</Label>
              <Input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>To Date</Label>
              <Input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} />
            </div>
            {isOwner && (
              <>
                <div className="space-y-2">
                  <Label>Branch</Label>
                  <Select value={filterBranch} onValueChange={setFilterBranch}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Branches</SelectItem>
                      {branches.map((b) => (
                        <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Staff</Label>
                  <Select value={filterStaff} onValueChange={setFilterStaff}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Staff</SelectItem>
                      {staffList.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.full_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Records Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Attendance Records
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground text-center py-8">Loading...</p>
          ) : records.length === 0 ? (
            <div className="text-center py-8">
              <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">No attendance records found for the selected filters.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    {isOwner && <TableHead>Staff</TableHead>}
                    {isOwner && <TableHead>Branch</TableHead>}
                    <TableHead>Check-In</TableHead>
                    <TableHead>Check-Out</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{new Date(r.date).toLocaleDateString()}</TableCell>
                      {isOwner && <TableCell>{r.staff_name}</TableCell>}
                      {isOwner && <TableCell>{r.branch_name}</TableCell>}
                      <TableCell>
                        {r.checkin_time ? new Date(r.checkin_time).toLocaleTimeString() : '—'}
                      </TableCell>
                      <TableCell>
                        {r.checkout_time ? new Date(r.checkout_time).toLocaleTimeString() : '—'}
                      </TableCell>
                      <TableCell>{statusBadge(r.attendance_status)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
