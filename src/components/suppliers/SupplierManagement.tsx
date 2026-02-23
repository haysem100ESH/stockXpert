import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import { Plus, Search, Edit, Trash2, Truck, Phone, Mail, MapPin, User } from 'lucide-react';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useBranchContext } from '@/hooks/useBranchContext';
import AddSupplierDialog from './AddSupplierDialog';
import EditSupplierDialog from './EditSupplierDialog';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';

interface Supplier {
  id: string;
  name: string;
  contact_person?: string;
  phone?: string;
  email?: string;
  address?: string;
  created_at: string;
}

export default function SupplierManagement() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [filteredSuppliers, setFilteredSuppliers] = useState<Supplier[]>([]);
  const [paginatedSuppliers, setPaginatedSuppliers] = useState<Supplier[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; supplierId: string; supplierName: string }>({ open: false, supplierId: '', supplierName: '' });
  const { toast } = useToast();
  const { profile } = useAuth();
  const { selectedBranch } = useBranchContext();
  
  const itemsPerPage = 15;

  useEffect(() => {
    fetchSuppliers();
  }, [selectedBranch]);

  useEffect(() => {
    const filtered = suppliers.filter(supplier =>
      supplier.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      supplier.contact_person?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      supplier.email?.toLowerCase().includes(searchTerm.toLowerCase())
    );
    setFilteredSuppliers(filtered);
    setCurrentPage(1); // Reset to first page when search changes
  }, [suppliers, searchTerm]);

  useEffect(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    setPaginatedSuppliers(filteredSuppliers.slice(startIndex, endIndex));
  }, [filteredSuppliers, currentPage]);

  const fetchSuppliers = async () => {
    try {
      // RLS policies handle ownership filtering automatically
      let query = supabase
        .from('suppliers')
        .select('*')
        .order('name');

      // Filter by specific branch if selected
      if (selectedBranch) {
        query = query.eq('branch_id', selectedBranch);
      }

      const { data, error } = await query;

      if (error) throw error;
      setSuppliers(data || []);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to fetch suppliers",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSupplierAdded = () => {
    fetchSuppliers();
    setShowAddDialog(false);
  };

  const handleSupplierUpdated = () => {
    fetchSuppliers();
    setShowEditDialog(false);
    setSelectedSupplier(null);
  };

  const handleEditSupplier = (supplier: Supplier) => {
    setSelectedSupplier(supplier);
    setShowEditDialog(true);
  };

  const handleDeleteSupplier = (supplierId: string, supplierName: string) => {
    if (!profile || profile.role !== 'owner') {
      toast({ title: "Error", description: "Only owners can delete suppliers", variant: "destructive" });
      return;
    }
    setDeleteConfirm({ open: true, supplierId, supplierName });
  };

  const confirmDeleteSupplier = async () => {
    setDeleteConfirm(prev => ({ ...prev, open: false }));
    try {
      const { error } = await supabase.from('suppliers').delete().eq('id', deleteConfirm.supplierId);
      if (error) throw error;
      toast({ title: "Success", description: "Supplier deleted successfully" });
      fetchSuppliers();
    } catch (error) {
      toast({ title: "Error", description: "Failed to delete supplier", variant: "destructive" });
    }
  };

  if (loading) {
    return <div>Loading suppliers...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Supplier Management</h2>
        {profile?.role === 'owner' && (
          <Button onClick={() => setShowAddDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Supplier
          </Button>
        )}
      </div>

      <div className="flex items-center space-x-4">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search suppliers by name, contact person, or email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-8"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {paginatedSuppliers.map((supplier) => (
          <Card key={supplier.id}>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex items-center space-x-2">
                  <Truck className="h-5 w-5 text-primary" />
                  <div>
                    <CardTitle className="text-lg">{supplier.name}</CardTitle>
                    {supplier.contact_person && (
                      <CardDescription className="flex items-center space-x-1 mt-1">
                        <User className="h-3 w-3" />
                        <span>{supplier.contact_person}</span>
                      </CardDescription>
                    )}
                  </div>
                </div>
                <div className="flex space-x-1">
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => handleEditSupplier(supplier)}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  {profile?.role === 'owner' && (
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={() => handleDeleteSupplier(supplier.id, supplier.name)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {supplier.phone && (
                  <div className="flex items-center space-x-2 text-sm">
                    <Phone className="h-4 w-4 text-muted-foreground" />
                    <span>{supplier.phone}</span>
                  </div>
                )}
                {supplier.email && (
                  <div className="flex items-center space-x-2 text-sm">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    <span>{supplier.email}</span>
                  </div>
                )}
                {supplier.address && (
                  <div className="flex items-start space-x-2 text-sm">
                    <MapPin className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <span className="text-wrap">{supplier.address}</span>
                  </div>
                )}
                
                <div className="text-xs text-muted-foreground">
                  Added: {new Date(supplier.created_at).toLocaleDateString()}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filteredSuppliers.length === 0 && (
        <div className="text-center py-8">
          <Truck className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">No suppliers found.</p>
        </div>
      )}

      {/* Pagination */}
      {Math.ceil(filteredSuppliers.length / itemsPerPage) > 1 && (
        <div className="flex justify-center">
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious 
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    if (currentPage > 1) setCurrentPage(currentPage - 1);
                  }}
                  className={currentPage === 1 ? "pointer-events-none opacity-50" : ""}
                />
              </PaginationItem>
              
              {Array.from({ length: Math.ceil(filteredSuppliers.length / itemsPerPage) }, (_, i) => i + 1).map((page) => (
                <PaginationItem key={page}>
                  <PaginationLink
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      setCurrentPage(page);
                    }}
                    isActive={currentPage === page}
                  >
                    {page}
                  </PaginationLink>
                </PaginationItem>
              ))}
              
              <PaginationItem>
                <PaginationNext 
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    if (currentPage < Math.ceil(filteredSuppliers.length / itemsPerPage)) setCurrentPage(currentPage + 1);
                  }}
                  className={currentPage === Math.ceil(filteredSuppliers.length / itemsPerPage) ? "pointer-events-none opacity-50" : ""}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}

      <div className="text-center text-sm text-muted-foreground">
        Showing {paginatedSuppliers.length} of {filteredSuppliers.length} suppliers
      </div>

      <AddSupplierDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        onSupplierAdded={handleSupplierAdded}
      />

      <EditSupplierDialog
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        supplier={selectedSupplier}
        onSupplierUpdated={handleSupplierUpdated}
      />

      <ConfirmationDialog
        open={deleteConfirm.open}
        onOpenChange={(open) => setDeleteConfirm(prev => ({ ...prev, open }))}
        title="Delete Supplier"
        description={`Are you sure you want to delete "${deleteConfirm.supplierName}"? This action cannot be undone.`}
        onConfirm={confirmDeleteSupplier}
        confirmText="Delete"
        cancelText="Cancel"
      />
    </div>
  );
}