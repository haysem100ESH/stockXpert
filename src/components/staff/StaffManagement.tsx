import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Users, Phone, Mail, Edit, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface StaffMember {
  id: string;
  full_name: string;
  role: 'owner' | 'staff';
  phone?: string;
  created_at: string;
}

export default function StaffManagement() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetchStaff();
  }, []);

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

  const handleUpdateRole = async (staffId: string, newRole: 'owner' | 'staff') => {
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ role: newRole })
        .eq('id', staffId);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Staff role updated successfully"
      });

      fetchStaff();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update staff role",
        variant: "destructive"
      });
    }
  };

  const handleDeleteStaff = async (staffId: string) => {
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
        
        <Dialog open={showInviteDialog} onOpenChange={setShowInviteDialog}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Invite Staff
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Invite Staff Member</DialogTitle>
              <DialogDescription>
                To add a new staff member, they need to sign up on the registration page with their own credentials.
                Share the registration link with them and ensure they select "Staff Member" as their role.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm font-medium mb-2">Registration URL:</p>
                <code className="text-xs bg-background p-2 rounded block">
                  {window.location.origin}/auth
                </code>
              </div>
              <p className="text-sm text-muted-foreground">
                New staff members will appear in this list once they register with a staff role.
              </p>
              <Button onClick={() => setShowInviteDialog(false)} className="w-full">
                Got it
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {staff.map((member) => (
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
                <div className="flex space-x-1">
                  <Button variant="ghost" size="sm">
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
                
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Role Management</Label>
                  <Select
                    value={member.role}
                    onValueChange={(value: 'owner' | 'staff') => handleUpdateRole(member.id, value)}
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="owner">Owner</SelectItem>
                      <SelectItem value="staff">Staff</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="text-xs text-muted-foreground">
                  Joined: {new Date(member.created_at).toLocaleDateString()}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {staff.length === 0 && (
        <div className="text-center py-8">
          <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">No staff members found.</p>
        </div>
      )}
    </div>
  );
}