import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useBranchContext } from '@/hooks/useBranchContext';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Trophy, Calendar as CalendarIcon, Medal, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

interface StaffRow { id: string; full_name: string | null; branch_id: string | null }
type FilterKey = 'today' | 'week' | 'month' | 'custom';

function startOfDay(d = new Date()) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function endOfDay(d = new Date()) { const x = new Date(d); x.setHours(23,59,59,999); return x; }
function startOfWeek(d = new Date()) { const x = startOfDay(d); const day = x.getDay(); const diff = (day === 0 ? -6 : 1 - day); x.setDate(x.getDate()+diff); return x; }
function startOfMonth(d = new Date()) { const x = startOfDay(d); x.setDate(1); return x; }

export default function Leaderboard({ onSelectStaff }: { onSelectStaff?: (s: StaffRow) => void }) {
  const { profile } = useAuth();
  const { selectedBranch } = useBranchContext();
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [rows, setRows] = useState<Array<{ user_id: string; created_at: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<FilterKey>('today');
  const [customDate, setCustomDate] = useState<Date | undefined>(new Date());
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (!profile || profile.role !== 'owner') return;
    (async () => {
      setLoading(true);
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

      // Fetch a wide window once (last 60 days) so client-side filtering is instant.
      const from = new Date();
      from.setDate(from.getDate() - 60);
      const { data: logs } = await (supabase as any)
        .from('activity_log')
        .select('user_id, created_at')
        .eq('owner_id', profile.id)
        .gte('created_at', from.toISOString());
      setRows(logs || []);
      setLoading(false);
    })();
  }, [profile, selectedBranch]);

  const ranked = useMemo(() => {
    let fromTs = 0;
    let toTs = Date.now();
    if (filter === 'today') fromTs = startOfDay().getTime();
    else if (filter === 'week') fromTs = startOfWeek().getTime();
    else if (filter === 'month') fromTs = startOfMonth().getTime();
    else if (filter === 'custom' && customDate) {
      fromTs = startOfDay(customDate).getTime();
      toTs = endOfDay(customDate).getTime();
    }
    const counts = new Map<string, number>();
    for (const r of rows) {
      const ts = new Date(r.created_at).getTime();
      if (ts >= fromTs && ts <= toTs) counts.set(r.user_id, (counts.get(r.user_id) || 0) + 1);
    }
    return staff
      .map((s) => ({ staff: s, name: s.full_name || 'Unnamed', count: counts.get(s.id) ?? 0 }))
      .sort((a, b) => b.count - a.count);
  }, [staff, rows, filter, customDate]);

  const filterLabel = (k: FilterKey) =>
    k === 'today' ? 'Today' : k === 'week' ? 'This Week' : k === 'month' ? 'This Month' : 'Custom Date';

  const subtitle = filter === 'custom' && customDate
    ? format(customDate, 'EEEE, MMM d, yyyy')
    : `Most active ${filterLabel(filter).toLowerCase()}`;

  const total = ranked.reduce((s, r) => s + r.count, 0);
  const top = ranked[0];

  const medalColor = (i: number) =>
    i === 0 ? 'text-amber-400' : i === 1 ? 'text-slate-300' : i === 2 ? 'text-amber-700' : 'text-muted-foreground';

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4 md:p-6">
        {/* Header */}
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-amber-500/10 p-2.5">
              <Trophy className="h-5 w-5 text-amber-500" />
            </div>
            <div>
              <h2 className="text-lg font-semibold leading-tight">Staff Leaderboard</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-right hidden sm:block">
              <div className="text-xs text-muted-foreground">Total actions</div>
              <div className="text-lg font-semibold tabular-nums">{total}</div>
            </div>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="mt-4 flex flex-wrap items-center gap-1.5 rounded-lg bg-muted/40 p-1">
          {(['today', 'week', 'month'] as FilterKey[]).map((k) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={cn(
                'flex-1 min-w-[80px] rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                filter === k ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {filterLabel(k)}
            </button>
          ))}
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <button
                onClick={() => setFilter('custom')}
                className={cn(
                  'flex-1 min-w-[110px] flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  filter === 'custom' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <CalendarIcon className="h-3.5 w-3.5" />
                {filter === 'custom' && customDate ? format(customDate, 'MMM d') : 'Pick a day'}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="single"
                selected={customDate}
                onSelect={(d) => { if (d) { setCustomDate(d); setFilter('custom'); setPickerOpen(false); } }}
                disabled={(d) => d > new Date()}
                initialFocus
                className={cn('p-3 pointer-events-auto')}
              />
            </PopoverContent>
          </Popover>
        </div>

        {/* Top performer highlight */}
        {!loading && top && top.count > 0 && (
          <button
            onClick={() => onSelectStaff?.(top.staff)}
            className="mt-4 w-full text-left rounded-lg border border-amber-500/20 bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent p-3 hover:border-amber-500/40 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/20">
                <Trophy className="h-5 w-5 text-amber-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[10px] uppercase tracking-wider font-semibold text-amber-500/80">Top Performer</div>
                <div className="font-semibold truncate">{top.name}</div>
              </div>
              <Badge className="bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border-0 tabular-nums">
                {top.count} actions
              </Badge>
            </div>
          </button>
        )}

        {/* List */}
        <div className="mt-3 space-y-1">
          {loading && <div className="py-6 text-center text-sm text-muted-foreground">Loading…</div>}
          {!loading && ranked.length === 0 && (
            <div className="py-6 text-center text-sm text-muted-foreground">No staff found.</div>
          )}
          {!loading && ranked.length > 0 && ranked.every((r) => r.count === 0) && (
            <div className="py-6 text-center text-sm text-muted-foreground">No activity in this period.</div>
          )}
          {!loading && ranked.map((e, i) => {
            const maxCount = Math.max(1, ranked[0]?.count ?? 1);
            const pct = (e.count / maxCount) * 100;
            return (
              <button
                key={e.staff.id}
                onClick={() => onSelectStaff?.(e.staff)}
                className="group relative flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left hover:bg-muted/50 transition-colors"
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center">
                  {i < 3 ? (
                    <Medal className={cn('h-4 w-4', medalColor(i))} />
                  ) : (
                    <span className="text-xs font-semibold text-muted-foreground tabular-nums">{i + 1}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium truncate">{e.name}</span>
                    <Badge variant="secondary" className="tabular-nums shrink-0">{e.count}</Badge>
                  </div>
                  <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all',
                        i === 0 ? 'bg-amber-500' : i === 1 ? 'bg-slate-400' : i === 2 ? 'bg-amber-700' : 'bg-primary/60'
                      )}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
