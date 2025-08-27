import { useAuth } from '@/hooks/useAuth';
import OwnerDashboard from '@/components/dashboard/OwnerDashboard';
import StaffDashboard from '@/components/dashboard/StaffDashboard';

export default function Dashboard() {
  const { profile } = useAuth();

  if (!profile) {
    return <div>Loading...</div>;
  }

  return (
    <div>
      {profile.role === 'owner' ? <OwnerDashboard /> : <StaffDashboard />}
    </div>
  );
}