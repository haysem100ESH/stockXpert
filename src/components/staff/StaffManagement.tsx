import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Users, Phone, Mail, Edit, Trash2, Search } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import EditStaffDialog from './EditStaffDialog';
import CreateStaffDialog from './CreateStaffDialog';

interface StaffMember {
  id: string;
  full_name: string;
  role: 'owner' | 'staff';
  phone?: string;
  created_at: string;
}

export default function StaffManagement() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [filteredStaff, setFilteredStaff] = useState<StaffMember[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [selectedStaff, setSelectedStaff] = useState<StaffMember | null>(null);
  const { toast } = useToast();
  const { profile } = useAuth();

  useEffect(() => {
    fetchStaff();
  }, []);

  useEffect(() => {
    const filtered = staff.filter(member =>
      member.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      member.phone?.toLowerCase().includes(searchTerm.toLowerCase())
    );
    setFilteredStaff(filtered);
  }, [staff, searchTerm]);

  const fetchStaff = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at');

      if (error) throw error;
      setStaff(data || []);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to fetch staff members",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handleEditStaff = (staff: StaffMember) => {
    setSelectedStaff(staff);
    setShowEditDialog(true);
  };

  const handleStaffUpdated = () => {
    fetchStaff();
    setShowEditDialog(false);
    setSelectedStaff(null);
  };

  const handleDeleteStaff = async (staffId: string) => {
    if (!profile || profile.role !== 'owner') {
      toast({
        title: "Error",
        description: "Only owners can delete staff members",
        variant: "destructive"
      });
      return;
    }

    if (!confirm("Are you sure you want to remove this staff member? This action cannot be undone.")) {
      return;
    }

    try {
      // Note: This will also delete the auth.users record due to CASCADE
      const { error } = await supabase
        .from('profiles')
        .delete()
        .eq('id', staffId);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Staff member removed successfully"
      });

      fetchStaff();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to remove staff member",
        variant: "destructive"
      });
    }
  };

  if (loading) {
    return <div>Loading staff members...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Staff Management</h2>
        
        {profile?.role === 'owner' && (
          <Button onClick={() => setShowCreateDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Create Staff Account
          </Button>
        )}
      </div>

      <div className="flex items-center space-x-4">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search staff by name or phone..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-8"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredStaff.map((member) => (
          <Card key={member.id}>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="flex items-center space-x-2">
                    <Users className="h-5 w-5" />
                    <span>{member.full_name}</span>
                  </CardTitle>
                  <div className="flex items-center space-x-2 mt-1">
                    <Badge variant={member.role === 'owner' ? 'default' : 'secondary'}>
                      {member.role === 'owner' ? 'Owner' : 'Staff'}
                    </Badge>
                  </div>
                </div>
                {profile?.role === 'owner' && (
                  <div className="flex space-x-1">
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={() => handleEditStaff(member)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    {member.role !== 'owner' && (
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => handleDeleteStaff(member.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
                <div className="space-y-3">
                  {member.phone && (
                    <div className="flex items-center space-x-2 text-sm">
                      <Phone className="h-4 w-4 text-muted-foreground" />
                      <span>{member.phone}</span>
                    </div>
                  )}
                  
                  {profile?.role === 'owner' && (
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">Quick Role Update</Label>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant={member.role === 'owner' ? 'default' : 'outline'}
                          onClick={() => handleEditStaff(member)}
                          className="flex-1"
                        >
                          {member.role === 'owner' ? 'Owner' : 'Make Owner'}
                        </Button>
                        <Button
                          size="sm"
                          variant={member.role === 'staff' ? 'default' : 'outline'}
                          onClick={() => handleEditStaff(member)}
                          className="flex-1"
                        >
                          {member.role === 'staff' ? 'Staff' : 'Make Staff'}
                        </Button>
                      </div>
                    </div>
                  )}

                  <div className="text-xs text-muted-foreground">
                    Joined: {new Date(member.created_at).toLocaleDateString()}
                  </div>
                </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filteredStaff.length === 0 && (
        <div className="text-center py-8">
          <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">No staff members found.</p>
        </div>
      )}

      <EditStaffDialog
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        staff={selectedStaff}
        onStaffUpdated={handleStaffUpdated}
      />

      <CreateStaffDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onStaffCreated={fetchStaff}
      />
    </div>
  );
}