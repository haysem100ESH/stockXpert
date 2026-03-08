import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Search, Edit2, Plus, Trash2, Filter, Settings2, Recycle, SlidersHorizontal } from 'lucide-react';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useBranchContext } from '@/hooks/useBranchContext';
import AddMedicineDialog from './AddMedicineDialog';
import EditMedicineDialog from './EditMedicineDialog';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import CategoryManagement from './CategoryManagement';
import OpenPackAdjustmentDialog from './OpenPackAdjustmentDialog';
import StockAdjustmentDialog from './StockAdjustmentDialog';

interface Medicine {
  id: string;
  name: string;
  generic_name?: string;
  category: string;
  selling_price: number;
  purchase_price: number;
  stock_quantity: number;
  minimum_stock_level: number;
  expiry_date?: string;
  batch_number?: string;
  manufacturer?: string;
  country_name?: string;
  units_per_pack?: number;
  open_pack_units?: number;
  unit_label?: string;
  branch_id?: string;
  branch_name?: string;
  creator?: {
    full_name: string;
    email: string;
  };
}

export default function StaffInventoryWithActions() {
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'inventory';
  const [activeTab, setActiveTab] = useState(initialTab);
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [filteredMedicines, setFilteredMedicines] = useState<Medicine[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [editingStock, setEditingStock] = useState<string | null>(null);
  const [tempStock, setTempStock] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showAddItemDialog, setShowAddItemDialog] = useState(false);
  const [showReplicateDialog, setShowReplicateDialog] = useState(false);
  const [editingMedicine, setEditingMedicine] = useState<Medicine | null>(null);
  const [medicineToReplicate, setMedicineToReplicate] = useState<Medicine | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState<{
    open: boolean;
    medicineId: string;
    medicineName: string;
  }>({
    open: false,
    medicineId: '',
    medicineName: ''
  });
  const [hasBranches, setHasBranches] = useState(true);
  const [adjustingMedicine, setAdjustingMedicine] = useState<Medicine | null>(null);
  const [stockAdjustMedicine, setStockAdjustMedicine] = useState<Medicine | null>(null);
  const { toast } = useToast();
  const { profile } = useAuth();
  const { selectedBranch, branchType } = useBranchContext();
  const isPharmacy = branchType === 'pharmacy';

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab) setActiveTab(tab);
  }, [searchParams]);

  useEffect(() => {
    if (profile) {
      setLoading(true);
      fetchMedicines();
      checkBranches();
    }
  }, [selectedBranch, profile?.id]);

  const checkBranches = async () => {
    try {
      let query = supabase
        .from('pharmacy_branches')
        .select('id')
        .limit(1);
      
      if (profile?.role === 'owner' && profile?.id) {
        query = query.eq('pharmacy_owner_id', profile.id);
      }

      const { data, error } = await query;
      
      if (error) throw error;
      setHasBranches(data && data.length > 0);
    } catch (error) {
      console.error('Error checking branches:', error);
    }
  };

  useEffect(() => {
    const medicineCategories = ['tablet', 'capsule', 'syrup', 'injection', 'cream', 'ointment', 'drops', 'inhaler'];
    
    const filtered = medicines.filter(medicine => {
      const matchesSearch = medicine.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        medicine.generic_name?.toLowerCase().includes(searchTerm.toLowerCase());
      
      let matchesCategory = true;
      if (categoryFilter === 'medicines_only') {
        matchesCategory = medicineCategories.includes(medicine.category);
      } else if (categoryFilter !== 'all') {
        matchesCategory = medicine.category === categoryFilter;
      }
      
      return matchesSearch && matchesCategory;
    });
    setFilteredMedicines(filtered);
  }, [medicines, searchTerm, categoryFilter]);

  const fetchMedicines = async () => {
    try {
      // Owner isolation: when "All Branches", only fetch from owner's branches
      let ownerBranchIds: string[] = [];
      if (!selectedBranch && profile?.role === 'owner' && profile?.id) {
        const { data: ownerBranches } = await supabase
          .from('pharmacy_branches')
          .select('id')
          .eq('pharmacy_owner_id', profile.id);
        ownerBranchIds = (ownerBranches || []).map((b: any) => b.id);
      }

      // If owner has no branches yet, show empty data
      if (!selectedBranch && ownerBranchIds.length === 0 && profile?.role === 'owner') {
        setMedicines([]);
        setLoading(false);
        return;
      }

      let query = supabase
        .from('medicines')
        .select('*')
        .order('name');

      if (selectedBranch) {
        query = query.eq('branch_id', selectedBranch);
      } else if (ownerBranchIds.length > 0) {
        query = query.in('branch_id', ownerBranchIds);
      }

      const { data, error } = await query;

      if (error) throw error;

      // Fetch branch names in bulk
      const branchIds = [...new Set((data || []).map((m: any) => m.branch_id).filter(Boolean))];
      const branchMap: Record<string, string> = {};
      if (branchIds.length > 0) {
        const { data: branches } = await supabase
          .from('pharmacy_branches')
          .select('id, name')
          .in('id', branchIds);
        (branches || []).forEach((b: any) => { branchMap[b.id] = b.name; });
      }
      
      const medicinesWithCreator = await Promise.all(
        (data || []).map(async (medicine: any) => {
          let creatorData = null;
          if (medicine.created_by) {
            const { data: cd } = await supabase
              .from('profiles')
              .select('full_name')
              .eq('id', medicine.created_by)
              .maybeSingle();
            creatorData = cd;
          }
          const openPackUnits = medicine.units_per_pack
            ? (medicine.open_pack_units || 0) / 1000
            : (medicine.open_pack_units || 0);
          const branchName = medicine.branch_id ? branchMap[medicine.branch_id] : undefined;
          return { ...medicine, creator: creatorData, open_pack_units: openPackUnits, branch_name: branchName };
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

  const handleStockEdit = (medicineId: string, currentStock: number) => {
    setEditingStock(medicineId);
    setTempStock(currentStock);
  };

  const handleStockUpdate = async (medicineId: string) => {
    try {
      const { error } = await supabase
        .from('medicines')
        .update({ stock_quantity: tempStock })
        .eq('id', medicineId);

      if (error) throw error;

      setMedicines(medicines.map(med => 
        med.id === medicineId ? { ...med, stock_quantity: tempStock } : med
      ));

      toast({
        title: "Success",
        description: "Stock updated successfully"
      });

      setEditingStock(null);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update stock",
        variant: "destructive"
      });
    }
  };

  const handleMedicineAdded = () => {
    fetchMedicines();
    setShowAddDialog(false);
  };

  const handleEditMedicine = (medicine: Medicine) => {
    setEditingMedicine(medicine);
  };

  const handleReplicateMedicine = (medicine: Medicine) => {
    setMedicineToReplicate(medicine);
    setShowReplicateDialog(true);
  };

  const handleMedicineUpdated = () => {
    fetchMedicines();
    setEditingMedicine(null);
  };

  const handleDeleteMedicine = (medicineId: string, medicineName: string) => {
    setDeleteConfirmation({
      open: true,
      medicineId,
      medicineName
    });
  };

  const confirmDeleteMedicine = async () => {
    try {
      // Find the medicine to calculate expense deduction
      const med = medicines.find(m => m.id === deleteConfirmation.medicineId);
      
      const { error } = await supabase
        .from('medicines')
        .delete()
        .eq('id', deleteConfirmation.medicineId);

      if (error) throw error;

      // Deduct remaining stock cost from expenses
      if (med && med.stock_quantity > 0) {
        const stockCost = med.stock_quantity * med.purchase_price;
        const branchId = med.branch_id || selectedBranch;
        await supabase.from('expenses').insert({
          description: `Item deleted: ${med.name} – ${med.stock_quantity} units remaining (cost deducted)`,
          amount: -stockCost,
          category: 'Stock Deletion',
          created_by: profile?.id || null,
          branch_id: branchId,
        });
      }

      setMedicines(medicines.filter(m => m.id !== deleteConfirmation.medicineId));
      
      toast({
        title: "Success",
        description: `${isPharmacy ? 'Medicine' : 'Item'} deleted successfully`
      });

      setDeleteConfirmation({ open: false, medicineId: '', medicineName: '' });
    } catch (error) {
      toast({
        title: "Error",
        description: `Failed to delete ${isPharmacy ? 'medicine' : 'item'}`,
        variant: "destructive"
      });
    }
  };

  const isOutOfStock = (medicine: Medicine) => medicine.stock_quantity === 0;
  const isLowStock = (medicine: Medicine) => medicine.stock_quantity > 0 && medicine.stock_quantity <= medicine.minimum_stock_level;
  const getUniqueCategories = () => [...new Set(medicines.map(m => m.category))].sort();

  const isExpired = (medicine: Medicine) => {
    if (!medicine.expiry_date) return false;
    const expiry = new Date(medicine.expiry_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    expiry.setHours(0, 0, 0, 0);
    return expiry <= today;
  };

  const isExpiringSoon = (medicine: Medicine) => {
    if (!medicine.expiry_date || isExpired(medicine)) return false;
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
    return new Date(medicine.expiry_date) <= thirtyDaysFromNow;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 gap-3">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <span className="text-muted-foreground">Loading {isPharmacy ? 'medicines' : 'items'}...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h2 className="text-xl sm:text-2xl font-bold">{isPharmacy ? 'Inventory Management' : 'Stock Management'}</h2>
          <div className="flex gap-2 flex-wrap">
            {isPharmacy && (
              <Button 
                onClick={() => setShowAddDialog(true)}
                disabled={!hasBranches}
                size="sm"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Medicine
              </Button>
            )}
            <Button 
              onClick={() => setShowAddItemDialog(true)}
              disabled={!hasBranches}
              variant={isPharmacy ? "outline" : "default"}
              size="sm"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Item
            </Button>
          </div>
        </div>
        {!hasBranches && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <p className="text-sm text-yellow-800">
              ⚠️ Please create a branch first before adding {isPharmacy ? 'medicines' : 'items'}.
            </p>
          </div>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-2 h-auto">
          <TabsTrigger value="inventory" className="text-xs sm:text-sm">{isPharmacy ? 'Medicines & Items' : 'Items'}</TabsTrigger>
          <TabsTrigger value="categories" className="text-xs sm:text-sm">Categories</TabsTrigger>
        </TabsList>

        <TabsContent value="inventory" className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={isPharmacy ? "Search medicines..." : "Search items..."}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8"
              />
            </div>

            <div className="flex items-center space-x-2">
              <Filter className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-full sm:w-48">
                  <SelectValue placeholder="Filter by category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {isPharmacy && <SelectItem value="medicines_only">Medicines Only</SelectItem>}
                  {getUniqueCategories().map((category) => (
                    <SelectItem key={category} value={category}>
                      {category}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredMedicines.map((medicine) => (
              <Card key={medicine.id} className={isExpired(medicine) ? "border-red-200 bg-red-50" : ""}>
                <CardHeader>
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <CardTitle className="text-lg">{medicine.name}</CardTitle>
                      {medicine.generic_name && (
                        <CardDescription>{medicine.generic_name}</CardDescription>
                      )}
                    </div>
                    <div className="flex space-x-1">
                      <Button size="sm" variant="ghost" onClick={() => handleEditMedicine(medicine)} title="Edit">
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => handleReplicateMedicine(medicine)} title="Replicate">
                        <Recycle className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setStockAdjustMedicine(medicine)} title="Adjust Stock">
                        <SlidersHorizontal className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => handleDeleteMedicine(medicine.id, medicine.name)} title="Delete">
                        <Trash2 className="h-4 w-4" />
                      </Button>
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
                    <div className="flex justify-between text-sm items-center">
                      <span>Stock:</span>
                      <div className="flex items-center space-x-2">
                        {editingStock === medicine.id ? (
                          <div className="flex items-center space-x-2">
                            <Input
                              type="number"
                              value={tempStock}
                              onChange={(e) => setTempStock(parseInt(e.target.value) || 0)}
                              className="w-20 h-8"
                            />
                            <Button size="sm" onClick={() => handleStockUpdate(medicine.id)} className="h-8">Save</Button>
                            <Button size="sm" variant="outline" onClick={() => setEditingStock(null)} className="h-8">Cancel</Button>
                          </div>
                        ) : (
                          <div className="flex items-center space-x-2">
                            <span className={(isLowStock(medicine) || isOutOfStock(medicine)) ? 'text-warning font-medium' : ''}>
                              {medicine.stock_quantity}
                            </span>
                            <Button size="sm" variant="ghost" onClick={() => handleStockEdit(medicine.id, medicine.stock_quantity)} className="h-6 w-6 p-0">
                              <Edit2 className="h-3 w-3" />
                            </Button>
                            {isOutOfStock(medicine) && <Badge variant="destructive" className="text-xs">Out of Stock</Badge>}
                            {isLowStock(medicine) && <Badge variant="destructive" className="text-xs">Low Stock</Badge>}
                          </div>
                        )}
                      </div>
                    </div>
                    {medicine.units_per_pack && (
                      <>
                         <div className="flex justify-between text-sm">
                          <span>Unopened Packs:</span>
                          <Badge variant="secondary">{medicine.stock_quantity}</Badge>
                        </div>
                        <div className="flex justify-between text-sm items-center">
                          <span>Open Pack:</span>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">
                              {medicine.open_pack_units || 0}/{medicine.units_per_pack} {medicine.unit_label || 'units'} remaining
                            </span>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 w-6 p-0"
                              onClick={() => setAdjustingMedicine(medicine)}
                              title="Adjust open pack units"
                            >
                              <Settings2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      </>
                    )}
                    {medicine.branch_name && (
                      <div className="flex justify-between text-sm">
                        <span>Branch:</span>
                        <Badge variant="outline">{medicine.branch_name}</Badge>
                      </div>
                    )}
                    {isPharmacy && medicine.expiry_date && (
                      <div className="flex justify-between text-sm">
                        <span>Expiry:</span>
                        <div className="flex items-center space-x-2">
                          <span className={isExpired(medicine) ? 'text-red-600 font-medium' : isExpiringSoon(medicine) ? 'text-orange-600' : ''}>
                            {new Date(medicine.expiry_date).toLocaleDateString()}
                          </span>
                          {isExpired(medicine) && <Badge variant="destructive" className="text-xs">Expired</Badge>}
                          {!isExpired(medicine) && isExpiringSoon(medicine) && (
                            <Badge variant="secondary" className="text-xs bg-orange-100 text-orange-800">Expiring Soon</Badge>
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
        </TabsContent>


        <TabsContent value="categories">
          <CategoryManagement />
        </TabsContent>
      </Tabs>

      {isPharmacy && (
        <AddMedicineDialog
          open={showAddDialog}
          onOpenChange={setShowAddDialog}
          onMedicineAdded={handleMedicineAdded}
        />
      )}

      <AddMedicineDialog
        open={showAddItemDialog}
        onOpenChange={setShowAddItemDialog}
        onMedicineAdded={handleMedicineAdded}
        mode="general"
      />

      <AddMedicineDialog
        open={showReplicateDialog}
        onOpenChange={setShowReplicateDialog}
        onMedicineAdded={handleMedicineAdded}
        replicateData={medicineToReplicate}
        mode={isPharmacy ? 'pharmacy' : 'general'}
      />

      {editingMedicine && (
        <EditMedicineDialog
          medicine={editingMedicine}
          open={!!editingMedicine}
          onOpenChange={(open) => !open && setEditingMedicine(null)}
          onMedicineUpdated={handleMedicineUpdated}
        />
      )}

      <ConfirmationDialog
        open={deleteConfirmation.open}
        onOpenChange={(open) => setDeleteConfirmation(prev => ({ ...prev, open }))}
        title={isPharmacy ? "Delete Medicine" : "Delete Item"}
        description={`Are you sure you want to delete "${deleteConfirmation.medicineName}"? This action cannot be undone.`}
        onConfirm={confirmDeleteMedicine}
        confirmText="Delete"
        cancelText="Cancel"
      />

      <OpenPackAdjustmentDialog
        open={!!adjustingMedicine}
        onOpenChange={(open) => { if (!open) setAdjustingMedicine(null); }}
        medicine={adjustingMedicine}
        onAdjusted={fetchMedicines}
      />

      <StockAdjustmentDialog
        open={!!stockAdjustMedicine}
        onOpenChange={(open) => { if (!open) setStockAdjustMedicine(null); }}
        medicine={stockAdjustMedicine}
        onAdjusted={fetchMedicines}
      />
    </div>
  );
}
