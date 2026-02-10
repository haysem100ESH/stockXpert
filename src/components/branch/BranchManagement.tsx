import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Building2, Plus, Edit, MapPin, Phone, User } from 'lucide-react';

interface Branch {
  id: string;
  name: string;
  address?: string;
  phone?: string;
  manager_staff_id?: string;
  is_main_branch: boolean;
  branch_type: 'pharmacy' | 'general';
  created_at: string;
  manager_name?: string;
}

interface StaffMember {
  id: string;
  full_name: string;
}

import { usePlanLimits } from '@/hooks/usePlanLimits';
import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function BranchManagement() {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const { planLimits, refetch: refetchPlanLimits } = usePlanLimits();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [staffMembers, setStaffMembers] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);

  // Form state
  const [branchName, setBranchName] = useState('');
  const [branchAddress, setBranchAddress] = useState('');
  const [branchPhone, setBranchPhone] = useState('');
  const [branchType, setBranchType] = useState<'pharmacy' | 'general'>('pharmacy');
  const [managerId, setManagerId] = useState('unassigned');
  const [isMainBranch, setIsMainBranch] = useState(false);

  useEffect(() => {
    if (user && profile?.role === 'owner') {
      fetchBranches();
      fetchStaffMembers();
    }
  }, [user, profile]);

  const fetchBranches = async () => {
    try {
      setLoading(true);
      
      // First get branches
      const { data: branchesData, error: branchesError } = await supabase
        .from('pharmacy_branches')
        .select('*')
        .eq('pharmacy_owner_id', user!.id)
        .order('is_main_branch', { ascending: false })
        .order('created_at', { ascending: true });

      if (branchesError) throw branchesError;

      // Then get manager names for branches that have managers
      const branchesWithManagers = await Promise.all(
        (branchesData || []).map(async (branch) => {
          let managerName = 'Unassigned';
          
          if (branch.manager_staff_id) {
            const { data: managerData } = await supabase
              .from('profiles')
              .select('full_name')
              .eq('id', branch.manager_staff_id)
              .single();
            
            if (managerData) {
              managerName = managerData.full_name;
            }
          }
          
          return {
            ...branch,
            manager_name: managerName
          };
        })
      );

      setBranches(branchesWithManagers);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchStaffMembers = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('role', 'staff');

      if (error) throw error;
      setStaffMembers(data || []);
    } catch (error: any) {
      console.error('Error fetching staff:', error);
    }
  };

  const resetForm = () => {
    setBranchName('');
    setBranchAddress('');
    setBranchPhone('');
    setBranchType('pharmacy');
    setManagerId('unassigned');
    setIsMainBranch(false);
    setEditingBranch(null);
  };

  const handleCreateBranch = async () => {
    // Check plan limits
    if (planLimits && !planLimits.canAddBranch) {
      toast({
        title: "Plan Limit Reached",
        description: `You have reached your plan limit of ${planLimits.branchesLimit} branches. Please upgrade to add more branches.`,
        variant: "destructive"
      });
      return;
    }

    try {
      const { error } = await supabase
        .from('pharmacy_branches')
        .insert({
          pharmacy_owner_id: user!.id,
          name: branchName,
          address: branchAddress || null,
          phone: branchPhone || null,
          branch_type: branchType,
          manager_staff_id: managerId === 'unassigned' ? null : managerId,
          is_main_branch: isMainBranch
        });

      if (error) throw error;

      toast({
        title: "Success",
        description: "Branch created successfully"
      });

      resetForm();
      setShowCreateDialog(false);
      fetchBranches();
      refetchPlanLimits();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const handleUpdateBranch = async () => {
    if (!editingBranch) return;

    try {
      const { error } = await supabase
        .from('pharmacy_branches')
        .update({
          name: branchName,
          address: branchAddress || null,
          phone: branchPhone || null,
          branch_type: branchType,
          manager_staff_id: managerId === 'unassigned' ? null : managerId,
          is_main_branch: isMainBranch
        })
        .eq('id', editingBranch.id);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Branch updated successfully"
      });

      setEditingBranch(null);
      resetForm();
      fetchBranches();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const startEdit = (branch: Branch) => {
    setEditingBranch(branch);
    setBranchName(branch.name);
    setBranchAddress(branch.address || '');
    setBranchPhone(branch.phone || '');
    setManagerId(branch.manager_staff_id || 'unassigned');
    setIsMainBranch(branch.is_main_branch);
  };

  if (profile?.role !== 'owner') {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-muted-foreground">Branch management is only available for pharmacy owners.</p>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return <div className="flex justify-center items-center h-64">Loading branches...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Branch Management</h2>
          <p className="text-muted-foreground">Manage your pharmacy branches</p>
        </div>
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogTrigger asChild>
            <Button onClick={() => resetForm()}>
              <Plus className="mr-2 h-4 w-4" />
              Add Branch
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Branch</DialogTitle>
              <DialogDescription>
                Add a new branch to your pharmacy network
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-4">
              <div>
                <Label>Branch Name *</Label>
                <Input
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  placeholder="Enter branch name"
                  className="mt-2"
                />
              </div>

              <div>
                <Label>Address</Label>
                <Input
                  value={branchAddress}
                  onChange={(e) => setBranchAddress(e.target.value)}
                  placeholder="Enter branch address"
                  className="mt-2"
                />
              </div>

              <div>
                <Label>Phone</Label>
                <Input
                  value={branchPhone}
                  onChange={(e) => setBranchPhone(e.target.value)}
                  placeholder="Enter branch phone"
                  className="mt-2"
                />
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="main-branch"
                  checked={isMainBranch}
                  onChange={(e) => setIsMainBranch(e.target.checked)}
                />
                <Label htmlFor="main-branch">Set as main branch</Label>
              </div>

              <Button onClick={handleCreateBranch} disabled={!branchName} className="w-full">
                Create Branch
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Branches Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Your Branches ({branches.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {branches.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Branch Name</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {branches.map((branch) => (
                  <TableRow key={branch.id}>
                    <TableCell className="font-medium">{branch.name}</TableCell>
                    <TableCell>
                      {branch.address ? (
                        <div className="flex items-center gap-1">
                          <MapPin className="h-3 w-3 text-muted-foreground" />
                          {branch.address}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">No address</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {branch.phone ? (
                        <div className="flex items-center gap-1">
                          <Phone className="h-3 w-3 text-muted-foreground" />
                          {branch.phone}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">No phone</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {branch.is_main_branch ? (
                        <Badge className="bg-blue-100 text-blue-800">Main Branch</Badge>
                      ) : (
                        <Badge variant="outline">Branch</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button variant="outline" size="sm" onClick={() => startEdit(branch)}>
                            <Edit className="mr-1 h-3 w-3" />
                            Edit
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Edit Branch</DialogTitle>
                            <DialogDescription>
                              Update branch information
                            </DialogDescription>
                          </DialogHeader>
                          
                          <div className="space-y-4">
                            <div>
                              <Label>Branch Name *</Label>
                              <Input
                                value={branchName}
                                onChange={(e) => setBranchName(e.target.value)}
                                placeholder="Enter branch name"
                                className="mt-2"
                              />
                            </div>

                            <div>
                              <Label>Address</Label>
                              <Input
                                value={branchAddress}
                                onChange={(e) => setBranchAddress(e.target.value)}
                                placeholder="Enter branch address"
                                className="mt-2"
                              />
                            </div>

                            <div>
                              <Label>Phone</Label>
                              <Input
                                value={branchPhone}
                                onChange={(e) => setBranchPhone(e.target.value)}
                                placeholder="Enter branch phone"
                                className="mt-2"
                              />
                            </div>

                            <div className="flex items-center space-x-2">
                              <input
                                type="checkbox"
                                id="edit-main-branch"
                                checked={isMainBranch}
                                onChange={(e) => setIsMainBranch(e.target.checked)}
                              />
                              <Label htmlFor="edit-main-branch">Set as main branch</Label>
                            </div>

                            <Button onClick={handleUpdateBranch} disabled={!branchName} className="w-full">
                              Update Branch
                            </Button>
                          </div>
                        </DialogContent>
                      </Dialog>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-8">
              <Building2 className="mx-auto h-12 w-12 text-gray-400" />
              <h3 className="mt-2 text-sm font-medium text-gray-900">No branches</h3>
              <p className="mt-1 text-sm text-gray-500">Get started by creating your first branch.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}