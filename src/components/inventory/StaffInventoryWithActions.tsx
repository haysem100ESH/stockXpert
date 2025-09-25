import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Search, Edit2, Plus, Trash2, Filter } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useBranchContext } from '@/hooks/useBranchContext';
import AddMedicineDialog from './AddMedicineDialog';
import EditMedicineDialog from './EditMedicineDialog';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import InventoryDashboard from './InventoryDashboard';

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
}

export default function StaffInventoryWithActions() {
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [filteredMedicines, setFilteredMedicines] = useState<Medicine[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [editingStock, setEditingStock] = useState<string | null>(null);
  const [tempStock, setTempStock] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingMedicine, setEditingMedicine] = useState<Medicine | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState<{
    open: boolean;
    medicineId: string;
    medicineName: string;
  }>({
    open: false,
    medicineId: '',
    medicineName: ''
  });
  const { toast } = useToast();
  const { selectedBranch } = useBranchContext();

  useEffect(() => {
    fetchMedicines();
  }, [selectedBranch]);

  useEffect(() => {
    const filtered = medicines.filter(medicine => {
      const matchesSearch = medicine.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        medicine.generic_name?.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCategory = categoryFilter === 'all' || medicine.category === categoryFilter;
      return matchesSearch && matchesCategory;
    });
    setFilteredMedicines(filtered);
  }, [medicines, searchTerm, categoryFilter]);

  const fetchMedicines = async () => {
    try {
      let query = supabase
        .from('medicines')
        .select('*')
        .order('name');

      // Filter by selected branch if one is selected
      if (selectedBranch) {
        query = query.eq('branch_id', selectedBranch);
      }

      const { data, error } = await query;

      if (error) throw error;
      setMedicines(data || []);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to fetch medicines",
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
      const { error } = await supabase
        .from('medicines')
        .delete()
        .eq('id', deleteConfirmation.medicineId);

      if (error) throw error;

      setMedicines(medicines.filter(med => med.id !== deleteConfirmation.medicineId));
      
      toast({
        title: "Success",
        description: "Medicine deleted successfully"
      });

      setDeleteConfirmation({ open: false, medicineId: '', medicineName: '' });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete medicine",
        variant: "destructive"
      });
    }
  };

  const isOutOfStock = (medicine: Medicine) => {
    return medicine.stock_quantity === 0;
  };

  const isLowStock = (medicine: Medicine) => {
    return medicine.stock_quantity > 0 && medicine.stock_quantity <= medicine.minimum_stock_level;
  };

  const getUniqueCategories = () => {
    const categories = [...new Set(medicines.map(m => m.category))];
    return categories.sort();
  };

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
    return <div>Loading medicines...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Inventory Management</h2>
        <Button onClick={() => setShowAddDialog(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Medicine
        </Button>
      </div>

      <Tabs defaultValue="medicines" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="medicines">Medicines</TabsTrigger>
          <TabsTrigger value="alerts">Inventory Alerts</TabsTrigger>
        </TabsList>

        <TabsContent value="medicines" className="space-y-4">
          <div className="flex items-center space-x-4">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search medicines by name or generic name..."
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
                  {getUniqueCategories().map((category) => (
                    <SelectItem key={category} value={category}>
                      {category}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
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
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleEditMedicine(medicine)}
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDeleteMedicine(medicine.id, medicine.name)}
                      >
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
                            <Button
                              size="sm"
                              onClick={() => handleStockUpdate(medicine.id)}
                              className="h-8"
                            >
                              Save
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setEditingStock(null)}
                              className="h-8"
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center space-x-2">
                            <span className={(isLowStock(medicine) || isOutOfStock(medicine)) ? 'text-warning font-medium' : ''}>
                              {medicine.stock_quantity}
                            </span>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleStockEdit(medicine.id, medicine.stock_quantity)}
                              className="h-6 w-6 p-0"
                            >
                              <Edit2 className="h-3 w-3" />
                            </Button>
                            {isOutOfStock(medicine) && (
                              <Badge variant="destructive" className="text-xs">
                                Out of Stock
                              </Badge>
                            )}
                            {isLowStock(medicine) && (
                              <Badge variant="destructive" className="text-xs">
                                Low Stock
                              </Badge>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    {medicine.expiry_date && (
                      <div className="flex justify-between text-sm">
                        <span>Expiry:</span>
                        <div className="flex items-center space-x-2">
                          <span className={isExpired(medicine) ? 'text-red-600 font-medium' : isExpiringSoon(medicine) ? 'text-orange-600' : ''}>
                            {new Date(medicine.expiry_date).toLocaleDateString()}
                          </span>
                          {isExpired(medicine) && (
                            <Badge variant="destructive" className="text-xs">Expired</Badge>
                          )}
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
              <p className="text-muted-foreground">No medicines found.</p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="alerts">
          <InventoryDashboard />
        </TabsContent>
      </Tabs>

      <AddMedicineDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        onMedicineAdded={handleMedicineAdded}
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
        title="Delete Medicine"
        description={`Are you sure you want to delete "${deleteConfirmation.medicineName}"? This action cannot be undone.`}
        onConfirm={confirmDeleteMedicine}
        confirmText="Delete"
        cancelText="Cancel"
      />
    </div>
  );
}