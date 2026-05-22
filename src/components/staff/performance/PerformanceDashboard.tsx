import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';
import { Trophy, Star, TrendingUp, Medal, Users } from 'lucide-react';
import { supabase } from '@/lib/db';
import { useAuth } from '@/hooks/useAuth';

interface StaffPerformance {
  id: string;
  name: string;
  branch_name: string;
  attendanceScore: number;
  salesScore: number;
  overallScore: number;
  presentDays: number;
  lateDays: number;
  absentDays: number;
  totalSales: number;
  rank: number;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export default function PerformanceDashboard() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const [performances, setPerformances] = useState<StaffPerformance[]>([]);
  const [loading, setLoading] = useState(true);
  const { profile } = useAuth();

  useEffect(() => {
    if (profile?.id) fetchPerformance();
  }, [month, year, profile]);

  const fetchPerformance = async () => {
    setLoading(true);
    try {
      const startDate = new Date(year, month, 1).toISOString().split('T')[0];
      const endDate = new Date(year, month + 1, 0).toISOString().split('T')[0];
      const workingDays = getWorkingDays(year, month);

      // Fetch owner's branches
      const { data: branches } = await supabase
        .from('pharmacy_branches')
        .select('id, name')
        .eq('pharmacy_owner_id', profile!.id);

      const branchIds = (branches || []).map((b: any) => b.id);
      const branchMap: Record<string, string> = {};
      (branches || []).forEach((b: any) => { branchMap[b.id] = b.name; });

      if (!branchIds.length) { setPerformances([]); setLoading(false); return; }

      // Fetch staff in those branches
      const { data: staffData } = await supabase
        .from('profiles')
        .select('id, full_name, branch_id')
        .eq('role', 'staff')
        .in('branch_id', branchIds);

      if (!staffData?.length) { setPerformances([]); setLoading(false); return; }

      const staffIds = staffData.map((s: any) => s.id);

      // Fetch attendance and sales in parallel
      const [attendanceRes, salesRes] = await Promise.all([
        supabase
          .from('staff_attendance')
          .select('staff_id, attendance_status')
          .in('staff_id', staffIds)
          .gte('date', startDate)
          .lte('date', endDate),
        supabase
          .from('sales')
          .select('sold_by, created_by, total_amount')
          .or(`sold_by.in.(${staffIds.join(',')}),created_by.in.(${staffIds.join(',')})`)
          .gte('created_at', `${startDate}T00:00:00`)
          .lte('created_at', `${endDate}T23:59:59`),
      ]);

      // Aggregate per staff
      const attendanceMap: Record<string, { present: number; late: number; absent: number }> = {};
      (attendanceRes.data || []).forEach((a: any) => {
        if (!attendanceMap[a.staff_id]) attendanceMap[a.staff_id] = { present: 0, late: 0, absent: 0 };
        if (a.attendance_status === 'present') attendanceMap[a.staff_id].present++;
        else if (a.attendance_status === 'late') attendanceMap[a.staff_id].late++;
        else attendanceMap[a.staff_id].absent++;
      });

      const salesMap: Record<string, number> = {};
      (salesRes.data || []).forEach((s: any) => {
        const sellerId = s.sold_by || s.created_by;
        if (sellerId && staffIds.includes(sellerId)) {
          salesMap[sellerId] = (salesMap[sellerId] || 0) + Number(s.total_amount || 0);
        }
      });

      const maxSales = Math.max(...Object.values(salesMap), 1);

      const results: StaffPerformance[] = staffData.map((s: any) => {
        const att = attendanceMap[s.id] || { present: 0, late: 0, absent: 0 };
        const totalRecorded = att.present + att.late + att.absent;

        // Attendance score: present=100%, late=50%, absent=0%
        const attendanceScore = totalRecorded > 0
          ? Math.round(((att.present * 100 + att.late * 50) / (workingDays * 100)) * 100)
          : 0;

        // Sales score: normalized to top performer
        const totalSales = salesMap[s.id] || 0;
        const salesScore = Math.round((totalSales / maxSales) * 100);

        // Overall: 50% attendance + 50% sales
        const overallScore = Math.round(attendanceScore * 0.5 + salesScore * 0.5);

        return {
          id: s.id,
          name: s.full_name,
          branch_name: branchMap[s.branch_id] || 'Unknown',
          attendanceScore: Math.min(attendanceScore, 100),
          salesScore: Math.min(salesScore, 100),
          overallScore: Math.min(overallScore, 100),
          presentDays: att.present,
          lateDays: att.late,
          absentDays: att.absent,
          totalSales,
          rank: 0,
        };
      });

      // Rank
      results.sort((a, b) => b.overallScore - a.overallScore);
      results.forEach((r, i) => { r.rank = i + 1; });

      setPerformances(results);
    } catch (error) {
      console.error('Failed to fetch performance:', error);
    } finally {
      setLoading(false);
    }
  };

  const getWorkingDays = (year: number, month: number) => {
    let count = 0;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      const day = new Date(year, month, d).getDay();
      if (day !== 0) count++; // Exclude Sundays
    }
    return count;
  };

  const getRankIcon = (rank: number) => {
    if (rank === 1) return <Trophy className="h-5 w-5 text-yellow-500" />;
    if (rank === 2) return <Medal className="h-5 w-5 text-gray-400" />;
    if (rank === 3) return <Medal className="h-5 w-5 text-amber-700" />;
    return <span className="text-sm font-medium text-muted-foreground">#{rank}</span>;
  };

  const scoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600';
    if (score >= 60) return 'text-yellow-600';
    return 'text-destructive';
  };

  const years = Array.from({ length: 3 }, (_, i) => now.getFullYear() - i);

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Label>Month</Label>
          <Select value={month.toString()} onValueChange={(v) => setMonth(parseInt(v))}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MONTHS.map((m, i) => (
                <SelectItem key={i} value={i.toString()}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Label>Year</Label>
          <Select value={year.toString()} onValueChange={(v) => setYear(parseInt(v))}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Top Performers */}
      {!loading && performances.length >= 1 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {performances.slice(0, 3).map((p) => (
            <Card key={p.id} className={p.rank === 1 ? 'border-yellow-500/50 bg-yellow-500/5' : ''}>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3 mb-4">
                  {getRankIcon(p.rank)}
                  <div>
                    <p className="font-semibold">{p.name}</p>
                    <p className="text-xs text-muted-foreground">{p.branch_name}</p>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Overall Score</span>
                    <span className={`font-bold ${scoreColor(p.overallScore)}`}>{p.overallScore}%</span>
                  </div>
                  <Progress value={p.overallScore} className="h-2" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Full Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Staff Performance Rankings — {MONTHS[month]} {year}
          </CardTitle>
          <CardDescription>
            Score based on 50% attendance + 50% sales contribution
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-center py-8 text-muted-foreground">Loading...</p>
          ) : performances.length === 0 ? (
            <div className="text-center py-8">
              <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">No staff performance data for this period.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">Rank</TableHead>
                    <TableHead>Staff</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead className="text-center">Present</TableHead>
                    <TableHead className="text-center">Late</TableHead>
                    <TableHead className="text-center">Absent</TableHead>
                    <TableHead className="text-right">Attendance Score</TableHead>
                    <TableHead className="text-right">Sales</TableHead>
                    <TableHead className="text-right">Sales Score</TableHead>
                    <TableHead className="text-right">Overall</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {performances.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{getRankIcon(p.rank)}</TableCell>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell>{p.branch_name}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant="default">{p.presentDays}</Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="secondary">{p.lateDays}</Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="destructive">{p.absentDays}</Badge>
                      </TableCell>
                      <TableCell className={`text-right font-medium ${scoreColor(p.attendanceScore)}`}>
                        {p.attendanceScore}%
                      </TableCell>
                      <TableCell className="text-right">{p.totalSales.toLocaleString()}</TableCell>
                      <TableCell className={`text-right font-medium ${scoreColor(p.salesScore)}`}>
                        {p.salesScore}%
                      </TableCell>
                      <TableCell className={`text-right font-bold ${scoreColor(p.overallScore)}`}>
                        {p.overallScore}%
                      </TableCell>
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
