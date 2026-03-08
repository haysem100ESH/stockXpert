import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LogIn, LogOut, MapPin, Clock, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useBranchContext } from '@/hooks/useBranchContext';
import { haversineDistance } from '@/lib/haversine';

interface TodayRecord {
  id: string;
  checkin_time: string | null;
  checkout_time: string | null;
  attendance_status: string;
}

interface BranchSettings {
  latitude: number;
  longitude: number;
  radius_meters: number;
  work_start_time: string;
  late_start_time: string;
  absent_start_time: string;
  work_end_time: string;
}

export default function RecordAttendance() {
  const [todayRecord, setTodayRecord] = useState<TodayRecord | null>(null);
  const [branchSettings, setBranchSettings] = useState<BranchSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [recording, setRecording] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const { toast } = useToast();
  const { user, profile } = useAuth();
  const { selectedBranch } = useBranchContext();

  const branchId = profile?.branch_id || selectedBranch;

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (branchId && user?.id) {
      fetchData();
    }
  }, [branchId, user]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const today = new Date().toISOString().split('T')[0];

      const [settingsRes, attendanceRes] = await Promise.all([
        supabase
          .from('branch_attendance_settings')
          .select('latitude, longitude, radius_meters, work_start_time, late_start_time, absent_start_time, work_end_time')
          .eq('branch_id', branchId)
          .maybeSingle(),
        supabase
          .from('staff_attendance')
          .select('id, checkin_time, checkout_time, attendance_status')
          .eq('staff_id', user!.id)
          .eq('date', today)
          .maybeSingle(),
      ]);

      setBranchSettings(settingsRes.data || null);
      setTodayRecord(attendanceRes.data || null);
    } catch (error) {
      console.error('Failed to fetch attendance data:', error);
    } finally {
      setLoading(false);
    }
  };

  const determineStatus = (checkinTime: Date, settings: BranchSettings): string => {
    const timeStr = checkinTime.toTimeString().slice(0, 5); // HH:MM
    if (timeStr <= settings.work_start_time) return 'present';
    if (timeStr <= settings.late_start_time) return 'present';
    if (timeStr <= settings.absent_start_time) return 'late';
    return 'absent';
  };

  const getCurrentPosition = (): Promise<GeolocationPosition> => {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation is not supported'));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 15000,
      });
    });
  };

  const handleCheckIn = async () => {
    if (!branchSettings || !branchId || !user?.id) return;
    if (!branchSettings.latitude || !branchSettings.longitude) {
      toast({ title: 'Error', description: 'Store location has not been set. Contact your admin.', variant: 'destructive' });
      return;
    }

    setRecording(true);
    try {
      const pos = await getCurrentPosition();
      const distance = haversineDistance(
        pos.coords.latitude, pos.coords.longitude,
        branchSettings.latitude, branchSettings.longitude
      );

      if (distance > branchSettings.radius_meters) {
        toast({
          title: 'Outside Store Location',
          description: `You are ${Math.round(distance)}m away from the store. You must be within ${branchSettings.radius_meters}m to check in.`,
          variant: 'destructive',
        });
        return;
      }

      const now = new Date();
      const status = determineStatus(now, branchSettings);
      const today = now.toISOString().split('T')[0];

      const { error } = await supabase.from('staff_attendance').insert({
        staff_id: user.id,
        branch_id: branchId,
        date: today,
        checkin_time: now.toISOString(),
        checkin_lat: pos.coords.latitude,
        checkin_long: pos.coords.longitude,
        attendance_status: status,
      });

      if (error) throw error;
      toast({ title: 'Checked In', description: `Status: ${status.charAt(0).toUpperCase() + status.slice(1)} (${Math.round(distance)}m from store)` });
      fetchData();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message || 'Failed to check in', variant: 'destructive' });
    } finally {
      setRecording(false);
    }
  };

  const handleCheckOut = async () => {
    if (!branchSettings || !todayRecord) return;
    if (!branchSettings.latitude || !branchSettings.longitude) {
      toast({ title: 'Error', description: 'Store location has not been set.', variant: 'destructive' });
      return;
    }

    setRecording(true);
    try {
      const pos = await getCurrentPosition();
      const distance = haversineDistance(
        pos.coords.latitude, pos.coords.longitude,
        branchSettings.latitude, branchSettings.longitude
      );

      if (distance > branchSettings.radius_meters) {
        toast({
          title: 'Outside Store Location',
          description: `You are ${Math.round(distance)}m away from the store. You must be within ${branchSettings.radius_meters}m to check out.`,
          variant: 'destructive',
        });
        return;
      }

      const { error } = await supabase
        .from('staff_attendance')
        .update({
          checkout_time: new Date().toISOString(),
          checkout_lat: pos.coords.latitude,
          checkout_long: pos.coords.longitude,
        })
        .eq('id', todayRecord.id);

      if (error) throw error;
      toast({ title: 'Checked Out', description: 'Have a great rest of your day!' });
      fetchData();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message || 'Failed to check out', variant: 'destructive' });
    } finally {
      setRecording(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!branchSettings) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <AlertTriangle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">Attendance settings have not been configured for your branch.</p>
          <p className="text-sm text-muted-foreground mt-1">Please contact your admin to set up the store location.</p>
        </CardContent>
      </Card>
    );
  }

  const hasCheckedIn = !!todayRecord?.checkin_time;
  const hasCheckedOut = !!todayRecord?.checkout_time;

  const statusColor = todayRecord?.attendance_status === 'present'
    ? 'default'
    : todayRecord?.attendance_status === 'late'
    ? 'secondary'
    : 'destructive';

  return (
    <div className="space-y-6">
      {/* Current Time Display */}
      <Card>
        <CardContent className="py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Clock className="h-8 w-8 text-primary" />
              <div>
                <p className="text-3xl font-bold font-mono">
                  {currentTime.toLocaleTimeString()}
                </p>
                <p className="text-sm text-muted-foreground">
                  {currentTime.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                </p>
              </div>
            </div>
            {todayRecord && (
              <Badge variant={statusColor} className="text-sm px-3 py-1">
                {todayRecord.attendance_status.charAt(0).toUpperCase() + todayRecord.attendance_status.slice(1)}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Check-In Card */}
        <Card className={hasCheckedIn ? 'border-green-500/30 bg-green-500/5' : ''}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LogIn className="h-5 w-5" />
              Check-In
            </CardTitle>
            <CardDescription>Record your arrival at the store</CardDescription>
          </CardHeader>
          <CardContent>
            {hasCheckedIn ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-green-600">
                  <CheckCircle2 className="h-5 w-5" />
                  <span className="font-medium">Checked in at {new Date(todayRecord!.checkin_time!).toLocaleTimeString()}</span>
                </div>
                {todayRecord!.checkin_lat && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3" />
                    {todayRecord!.checkin_lat.toFixed(4)}, {todayRecord!.checkin_long?.toFixed(4)}
                  </div>
                )}
              </div>
            ) : (
              <Button onClick={handleCheckIn} disabled={recording} className="w-full" size="lg">
                {recording ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <LogIn className="h-4 w-4 mr-2" />}
                {recording ? 'Verifying Location...' : 'Record Check-In'}
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Check-Out Card */}
        <Card className={hasCheckedOut ? 'border-blue-500/30 bg-blue-500/5' : ''}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LogOut className="h-5 w-5" />
              Check-Out
            </CardTitle>
            <CardDescription>Record your departure from the store</CardDescription>
          </CardHeader>
          <CardContent>
            {!hasCheckedIn ? (
              <p className="text-sm text-muted-foreground">You must check in first</p>
            ) : hasCheckedOut ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-blue-600">
                  <CheckCircle2 className="h-5 w-5" />
                  <span className="font-medium">Checked out at {new Date(todayRecord!.checkout_time!).toLocaleTimeString()}</span>
                </div>
                {todayRecord!.checkout_lat && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3" />
                    {todayRecord!.checkout_lat.toFixed(4)}, {todayRecord!.checkout_long?.toFixed(4)}
                  </div>
                )}
              </div>
            ) : (
              <Button onClick={handleCheckOut} disabled={recording} variant="secondary" className="w-full" size="lg">
                {recording ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <LogOut className="h-4 w-4 mr-2" />}
                {recording ? 'Verifying Location...' : 'Record Check-Out'}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Time Rules Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Today's Schedule</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Work Start</p>
              <p className="font-medium">{branchSettings.work_start_time}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Late After</p>
              <p className="font-medium">{branchSettings.late_start_time}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Absent After</p>
              <p className="font-medium">{branchSettings.absent_start_time}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Work End</p>
              <p className="font-medium">{branchSettings.work_end_time}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
