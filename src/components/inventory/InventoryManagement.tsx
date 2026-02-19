import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import { Plus, Search, Edit, Trash2, CalendarIcon, Filter } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useBranchContext } from '@/hooks/useBranchContext';
import AddMedicineDialog from './AddMedicineDialog';
import EditMedicineDialog from './EditMedicineDialog';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';

interface Medicine {
  id: string;
  name: string;
  generic_name?: string;
  category: string;
  manufacturer?: string;
  batch_number?: string;
  country_name?: string;
  purchase_price: number;
  selling_price: number;
  stock_quantity: number;
  minimum_stock_level: number;
  expiry_date?: string;
  expiry_alert_enabled?: boolean;
  created_at?: string;
  creator?: {
    full_name: string;
    email: string;
  };
}

export default function InventoryManagement() {
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [filteredMedicines, setFilteredMedicines] = useState<Medicine[]>([]);
  const [paginatedMedicines, setPaginatedMedicines] = useState<Medicine[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState<Date | undefined>();
  const [currentPage, setCurrentPage] = useState(1);
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showAddItemDialog, setShowAddItemDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showReplicateDialog, setShowReplicateDialog] = useState(false);
  const [selectedMedicine, setSelectedMedicine] = useState<Medicine | null>(null);
  const [medicineToReplicate, setMedicineToReplicate] = useState<Medicine | null>(null);
  const [medicineToDelete, setMedicineToDelete] = useState<string | null>(null);
  const { toast } = useToast();
  const { profile } = useAuth();
  const { selectedBranch, branchType } = useBranchContext();
  const isPharmacy = branchType === 'pharmacy';
  
  const itemsPerPage = 15;

  useEffect(() => {
    fetchMedicines();
  }, [selectedBranch]);

  useEffect(() => {
    const medicineCategories = ['tablet', 'capsule', 'syrup', 'injection', 'cream', 'ointment', 'drops', 'inhaler'];
    
    let filtered = medicines.filter(medicine => {
      const matchesSearch = medicine.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        medicine.generic_name?.toLowerCase().includes(searchTerm.toLowerCase());
      
      let matchesCategory = true;
      if (categoryFilter === 'medicines_only') {
        matchesCategory = medicineCategories.includes(medicine.category);
      } else if (categoryFilter !== 'all') {
        matchesCategory = medicine.category === categoryFilter;
      }
      
      let matchesDate = true;
      if (dateFilter) {
        const medicineDate = new Date(medicine.created_at || '');
        const filterDate = new Date(dateFilter);
        medicineDate.setHours(0, 0, 0, 0);
        filterDate.setHours(0, 0, 0, 0);
        matchesDate = medicineDate.getTime() === filterDate.getTime();
      }
      
      return matchesSearch && matchesCategory && matchesDate;
    });
    
    setFilteredMedicines(filtered);
    setCurrentPage(1);
  }, [medicines, searchTerm, categoryFilter, dateFilter]);

  useEffect(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    setPaginatedMedicines(filteredMedicines.slice(startIndex, endIndex));
  }, [filteredMedicines, currentPage]);

  useEffect(() => {
    const counts: Record<string, number> = {};
    medicines.forEach(medicine => {
      counts[medicine.category] = (counts[medicine.category] || 0) + 1;
    });
    setCategoryCounts(counts);
  }, [medicines]);

  const fetchMedicines = async () => {
    try {
      let query = supabase
        .from('medicines')
        .select('*')
        .order('name');

      if (selectedBranch) {
        query = query.eq('branch_id', selectedBranch);
      }

      const { data, error } = await query;

      if (error) throw error;
      
      const medicinesWithCreator = await Promise.all(
        (data || []).map(async (medicine: any) => {
          if (medicine.created_by) {
            const { data: creatorData } = await supabase
              .from('profiles')
              .select('full_name')
              .eq('id', medicine.created_by)
              .maybeSingle();
            
            return { ...medicine, creator: creatorData };
          }
          return medicine;
        })
      );
      
      setMedicines(medicinesWithCreator);
    } catch (error) {
      toast({
        title: "Error",
        description: `Failed to fetch ${isPharmacy ? 'medicines' : 'items'}`,
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handleMedicineAdded = () => {
    fetchMedicines();
    setShowAddDialog(false);
  };

  const totalPages = Math.ceil(filteredMedicines.length / itemsPerPage);
  const getUniqueCategories = () => [...new Set(medicines.map(m => m.category))].sort();
  const isOutOfStock = (medicine: Medicine) => medicine.stock_quantity === 0;
  const isLowStock = (medicine: Medicine) => medicine.stock_quantity > 0 && medicine.stock_quantity <= medicine.minimum_stock_level;

  const isExpired = (expiryDate?: string) => {
    if (!expiryDate) return false;
    const expiry = new Date(expiryDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    expiry.setHours(0, 0, 0, 0);
    return expiry <= today;
  };

  const isExpiringSoon = (expiryDate?: string) => {
    if (!expiryDate) return false;
    if (isExpired(expiryDate)) return false;
    const expiry = new Date(expiryDate);
    const now = new Date();
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(now.getDate() + 30);
    return expiry <= thirtyDaysFromNow;
  };

  const handleEditMedicine = (medicine: Medicine) => {
    setSelectedMedicine(medicine);
    setShowEditDialog(true);
  };

  const handleReplicateMedicine = (medicine: Medicine) => {
    setMedicineToReplicate(medicine);
    setShowReplicateDialog(true);
  };

  const handleDeleteMedicine = (medicineId: string) => {
    if (!profile || profile.role !== 'owner') {
      toast({
        title: "Error",
        description: `Only owners can delete ${isPharmacy ? 'medicines' : 'items'}`,
        variant: "destructive"
      });
      return;
    }
    setMedicineToDelete(medicineId);
    setShowDeleteConfirm(true);
  };

  const confirmDeleteMedicine = async () => {
    if (!medicineToDelete) return;
    setShowDeleteConfirm(false);
    try {
      const { error } = await supabase.from('medicines').delete().eq('id', medicineToDelete);
      if (error) throw error;
      toast({ title: "Success", description: `${isPharmacy ? 'Medicine' : 'Item'} deleted successfully` });
      fetchMedicines();
    } catch (error) {
      toast({ title: "Error", description: `Failed to delete ${isPharmacy ? 'medicine' : 'item'}`, variant: "destructive" });
    } finally {
      setMedicineToDelete(null);
    }
  };

  if (loading) {
    return <div>Loading {isPharmacy ? 'medicines' : 'items'}...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">{isPharmacy ? 'Inventory Management' : 'Stock Management'}</h2>
        <div className="flex gap-2">
          {isPharmacy && (
            <Button onClick={() => setShowAddDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Medicine
            </Button>
          )}
          <Button onClick={() => setShowAddItemDialog(true)} variant={isPharmacy ? "outline" : "default"}>
            <Plus className="h-4 w-4 mr-2" />
            Add Item
          </Button>
        </div>
      </div>

        <div className="flex items-center space-x-4">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={isPharmacy ? "Search medicines by name or generic name..." : "Search items by name or description..."}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8"
            />
          </div>
          
          <div className="flex items-center space-x-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Filter by category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {isPharmacy && <SelectItem value="medicines_only">Medicines Only</SelectItem>}
                {getUniqueCategories().map((category) => (
                  <SelectItem key={category} value={category}>
                    {category} ({categoryCounts[category] || 0})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-48 justify-start text-left font-normal">
                <CalendarIcon className="mr-2 h-4 w-4" />
                {dateFilter ? format(dateFilter, "PPP") : <span>Filter by date</span>}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0">
              <Calendar mode="single" selected={dateFilter} onSelect={setDateFilter} initialFocus className="p-3 pointer-events-auto" />
              <div className="p-3 border-t">
                <Button variant="ghost" className="w-full text-sm" onClick={() => setDateFilter(undefined)}>Clear filter</Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {paginatedMedicines.map((medicine) => (
          <Card key={medicine.id} className="relative">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-lg">{medicine.name}</CardTitle>
                  {medicine.generic_name && <CardDescription>{medicine.generic_name}</CardDescription>}
                </div>
                <div className="flex space-x-1">
                  <Button variant="ghost" size="sm" onClick={() => handleEditMedicine(medicine)} title="Edit"><Edit className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="sm" onClick={() => handleReplicateMedicine(medicine)} title="Replicate"><Plus className="h-4 w-4" /></Button>
                  {profile?.role === 'owner' && (
                    <Button variant="ghost" size="sm" onClick={() => handleDeleteMedicine(medicine.id)} title="Delete"><Trash2 className="h-4 w-4" /></Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Category:</span>
                  <Badge variant="outline">{medicine.category}</Badge>
                </div>
                {isPharmacy && medicine.batch_number && (
                  <div className="flex justify-between text-sm">
                    <span>Batch:</span>
                    <span>{medicine.batch_number}</span>
                  </div>
                )}
                {medicine.country_name && (
                  <div className="flex justify-between text-sm">
                    <span>Country:</span>
                    <span>{medicine.country_name}</span>
                  </div>
                )}
                {medicine.manufacturer && (
                  <div className="flex justify-between text-sm">
                    <span>{isPharmacy ? 'Manufacturer' : 'Brand'}:</span>
                    <span>{medicine.manufacturer}</span>
                  </div>
                )}
                {medicine.creator && (
                  <div className="flex justify-between text-sm">
                    <span>Added by:</span>
                    <span className="text-xs">{medicine.creator.full_name || medicine.creator.email}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span>Price:</span>
                  <span className="font-medium">ETB {medicine.selling_price}</span>
                </div>
                  <div className="flex justify-between text-sm">
                   <span>Stock:</span>
                   <div className="flex items-center space-x-2">
                     <span className={(isLowStock(medicine) || isOutOfStock(medicine)) ? 'text-warning font-medium' : ''}>
                       {medicine.stock_quantity}
                     </span>
                     {isOutOfStock(medicine) && <Badge variant="destructive" className="text-xs">Out of Stock</Badge>}
                     {isLowStock(medicine) && <Badge variant="destructive" className="text-xs">Low Stock</Badge>}
                   </div>
                 </div>
                {isPharmacy && medicine.expiry_date && (
                  <div className="flex justify-between text-sm">
                    <span>Expires:</span>
                    <div className="flex items-center space-x-2">
                      <span className={
                        isExpired(medicine.expiry_date) ? 'text-destructive font-medium' 
                          : isExpiringSoon(medicine.expiry_date) ? 'text-warning' : ''
                      }>
                        {new Date(medicine.expiry_date).toLocaleDateString()}
                      </span>
                      {isExpired(medicine.expiry_date) && <Badge variant="destructive" className="text-xs">Expired</Badge>}
                      {!isExpired(medicine.expiry_date) && isExpiringSoon(medicine.expiry_date) && (
                        <Badge variant="destructive" className="text-xs">Expiring Soon</Badge>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filteredMedicines.length === 0 && (
        <div className="text-center py-8">
          <p className="text-muted-foreground">No {isPharmacy ? 'medicines' : 'items'} found.</p>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex justify-center">
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious href="#" onClick={(e) => { e.preventDefault(); if (currentPage > 1) setCurrentPage(currentPage - 1); }} className={currentPage === 1 ? "pointer-events-none opacity-50" : ""} />
              </PaginationItem>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                <PaginationItem key={page}>
                  <PaginationLink href="#" onClick={(e) => { e.preventDefault(); setCurrentPage(page); }} isActive={currentPage === page}>{page}</PaginationLink>
                </PaginationItem>
              ))}
              <PaginationItem>
                <PaginationNext href="#" onClick={(e) => { e.preventDefault(); if (currentPage < totalPages) setCurrentPage(currentPage + 1); }} className={currentPage === totalPages ? "pointer-events-none opacity-50" : ""} />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}

      <div className="text-center text-sm text-muted-foreground">
        Showing {paginatedMedicines.length} of {filteredMedicines.length} {isPharmacy ? 'medicines' : 'items'}
      </div>

      {isPharmacy && (
        <AddMedicineDialog open={showAddDialog} onOpenChange={setShowAddDialog} onMedicineAdded={handleMedicineAdded} />
      )}

      <AddMedicineDialog open={showAddItemDialog} onOpenChange={setShowAddItemDialog} onMedicineAdded={handleMedicineAdded} mode="general" />

      <EditMedicineDialog open={showEditDialog} onOpenChange={setShowEditDialog} medicine={selectedMedicine} onMedicineUpdated={handleMedicineAdded} />

      {isPharmacy && (
        <AddMedicineDialog open={showReplicateDialog} onOpenChange={setShowReplicateDialog} onMedicineAdded={handleMedicineAdded} replicateData={medicineToReplicate} />
      )}

      <ConfirmationDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title={isPharmacy ? "Delete Medicine" : "Delete Item"}
        description={isPharmacy ? "Are you sure you want to delete this medicine? This action cannot be undone." : "Are you sure you want to delete this item? This action cannot be undone."}
        onConfirm={confirmDeleteMedicine}
        confirmText="Delete"
      />
    </div>
  );
}
