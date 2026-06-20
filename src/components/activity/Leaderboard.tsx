import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useBranchContext } from '@/hooks/useBranchContext';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Trophy } from 'lucide-react';

interface StaffRow { id: string; full_name: string | null; branch_id: string | null }
interface LeaderEntry { staffId: string; name: string; count: number }

function startOfDay(d = new Date()) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function startOfWeek(d = new Date()) { const x = startOfDay(d); const day = x.getDay(); const diff = (day === 0 ? -6 : 1 - day); x.setDate(x.getDate()+diff); return x; }
function startOfMonth(d = new Date()) { const x = startOfDay(d); x.setDate(1); return x; }

export default function Leaderboard({ onSelectStaff }: { onSelectStaff?: (s: StaffRow) => void }) {
  const { profile } = useAuth();
  const { selectedBranch } = useBranchContext();
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [counts, setCounts] = useState<Record<string, { today: number; week: number; month: number }>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!profile || profile.role !== 'owner') return;
    (async () => {
      setLoading(true);
      // staff working under this owner
      const { data: branches } = await (supabase as any)
        .from('pharmacy_branches')
        .select('id')
        .eq('pharmacy_owner_id', profile.id);
      const branchIds = (branches || []).map((b: any) => b.id);
      const branchFilter = selectedBranch ? [selectedBranch] : branchIds;
      const { data: people } = await (supabase as any)
        .from('profiles')
        .select('id, full_name, branch_id')
        .eq('role', 'staff')
        .in('branch_id', branchFilter.length ? branchFilter : ['00000000-0000-0000-0000-000000000000']);
      setStaff((people || []) as StaffRow[]);

      const fromMonth = startOfMonth().toISOString();
      const { data: rows } = await (supabase as any)
        .from('activity_log')
        .select('user_id, created_at')
        .eq('owner_id', profile.id)
        .gte('created_at', fromMonth);

      const today = startOfDay().getTime();
      const week = startOfWeek().getTime();
      const agg: typeof counts = {};
      for (const r of (rows || [])) {
        const id = r.user_id;
        if (!agg[id]) agg[id] = { today: 0, week: 0, month: 0 };
        const ts = new Date(r.created_at).getTime();
        agg[id].month++;
        if (ts >= week) agg[id].week++;
        if (ts >= today) agg[id].today++;
      }
      setCounts(agg);
      setLoading(false);
    })();
  }, [profile, selectedBranch]);

  const ranked = (key: 'today' | 'week' | 'month'): LeaderEntry[] =>
    staff
      .map((s) => ({ staffId: s.id, name: s.full_name || 'Unnamed', count: counts[s.id]?.[key] ?? 0 }))
      .sort((a, b) => b.count - a.count);

  const sections: Array<{ title: string; key: 'today' | 'week' | 'month' }> = [
    { title: 'Most Active Today',     key: 'today' },
    { title: 'Most Active This Week', key: 'week'  },
    { title: 'Most Active This Month',key: 'month' },
  ];

  if (loading) return <div className="text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {sections.map((sec) => (
        <Card key={sec.key}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Trophy className="h-4 w-4 text-amber-500" />
              <h3 className="font-semibold text-sm">{sec.title}</h3>
            </div>
            <div className="space-y-2">
              {ranked(sec.key).slice(0, 5).map((e, i) => {
                const s = staff.find((x) => x.id === e.staffId);
                return (
                  <button
                    key={e.staffId}
                    onClick={() => s && onSelectStaff?.(s)}
                    className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-muted/50 transition-colors"
                  >
                    <span className="w-5 text-center text-xs font-semibold text-muted-foreground">{i + 1}</span>
                    <span className="flex-1 truncate text-sm">{e.name}</span>
                    <Badge variant="secondary" className="tabular-nums">{e.count}</Badge>
                  </button>
                );
              })}
              {ranked(sec.key).length === 0 && <div className="text-xs text-muted-foreground">No activity yet.</div>}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
