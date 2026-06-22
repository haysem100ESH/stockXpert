import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import Leaderboard, { type LeaderboardRange } from '@/components/activity/Leaderboard';
import GoalManager from '@/components/activity/GoalManager';
import ActivityRowItem from '@/components/activity/ActivityRowItem';
import { useActivityFeed } from '@/hooks/useActivityFeed';
import { toast } from '@/hooks/use-toast';

interface StaffPick { id: string; full_name: string | null }

function StaffActivityDrawer({ staff, range, onClose }: { staff: StaffPick | null; range: LeaderboardRange | null; onClose: () => void }) {
  const { rows, loading } = useActivityFeed({ userId: staff?.id, limit: 200, from: range?.from, to: range?.to });
  return (
    <Sheet open={!!staff} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{staff?.full_name || 'Staff'} — Activity</SheetTitle>
          <p className="text-xs text-muted-foreground">{range?.label || 'All Time'}</p>
        </SheetHeader>
        <div className="mt-4 space-y-2">
          {loading && <div className="text-sm text-muted-foreground">Loading…</div>}
          {!loading && rows.length === 0 && <div className="text-sm text-muted-foreground">No activity yet.</div>}
          {rows.map((r) => <ActivityRowItem key={r.id} row={r} />)}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default function OwnerActivityCenterPage() {
  const { profile } = useAuth();
  const [selected, setSelected] = useState<StaffPick | null>(null);
  const [selectedRange, setSelectedRange] = useState<LeaderboardRange | null>(null);

  // Goal completion notifications
  useEffect(() => {
    if (!profile || profile.role !== 'owner') return;
    const ch = (supabase as any)
      .channel(`owner-goal-completions-${profile.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'staff_goal_completions' }, async (payload: any) => {
        const r = payload.new;
        if (r.owner_id !== profile.id) return;
        const [{ data: g }, { data: s }] = await Promise.all([
          (supabase as any).from('staff_goals').select('name').eq('id', r.goal_id).maybeSingle(),
          (supabase as any).from('profiles').select('full_name, branch_id').eq('id', r.staff_id).maybeSingle(),
        ]);
        const time = new Date(r.completed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        toast({
          title: '🎯 Goal Completed',
          description: `${(s as any)?.full_name || 'A staff'} completed ${(g as any)?.name || 'a goal'} at ${time}`,
        });
      })
      .subscribe();
    return () => { (supabase as any).removeChannel(ch); };
  }, [profile]);

  if (profile?.role !== 'owner') return <div className="p-6">Only owners can view this page.</div>;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">Activity Center</h1>
        <p className="text-sm text-muted-foreground">Monitor your team's productivity in real time.</p>
      </div>

      <Leaderboard onSelectStaff={(s) => setSelected({ id: s.id, full_name: s.full_name })} />

      <GoalManager />

      <StaffActivityDrawer staff={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
