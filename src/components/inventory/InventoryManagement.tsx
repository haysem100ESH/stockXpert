import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Plus, Search, Edit, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import AddMedicineDialog from './AddMedicineDialog';

interface Medicine {
  id: string;
  name: string;
  generic_name?: string;
  category: string;
  manufacturer?: string;
  selling_price: number;
  stock_quantity: number;
  minimum_stock_level: number;
  expiry_date?: string;
}

export default function InventoryManagement() {
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [filteredMedicines, setFilteredMedicines] = useState<Medicine[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetchMedicines();
  }, []);

  useEffect(() => {
    const filtered = medicines.filter(medicine =>
      medicine.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      medicine.generic_name?.toLowerCase().includes(searchTerm.toLowerCase())
    );
    setFilteredMedicines(filtered);
  }, [medicines, searchTerm]);

  const fetchMedicines = async () => {
    try {
      const { data, error } = await supabase
        .from('medicines')
        .select('*')
        .order('name');

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

  const handleMedicineAdded = () => {
    fetchMedicines();
    setShowAddDialog(false);
  };

  const isLowStock = (medicine: Medicine) => {
    return medicine.stock_quantity <= medicine.minimum_stock_level;
  };

  const isExpiringSoon = (expiryDate?: string) => {
    if (!expiryDate) return false;
    const expiry = new Date(expiryDate);
    const now = new Date();
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(now.getDate() + 30);
    return expiry <= thirtyDaysFromNow;
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
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredMedicines.map((medicine) => (
          <Card key={medicine.id} className="relative">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-lg">{medicine.name}</CardTitle>
                  {medicine.generic_name && (
                    <CardDescription>{medicine.generic_name}</CardDescription>
                  )}
                </div>
                <div className="flex space-x-1">
                  <Button variant="ghost" size="sm">
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm">
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
                {medicine.manufacturer && (
                  <div className="flex justify-between text-sm">
                    <span>Manufacturer:</span>
                    <span>{medicine.manufacturer}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span>Price:</span>
                  <span className="font-medium">${medicine.selling_price}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Stock:</span>
                  <div className="flex items-center space-x-2">
                    <span className={isLowStock(medicine) ? 'text-warning font-medium' : ''}>
                      {medicine.stock_quantity}
                    </span>
                    {isLowStock(medicine) && (
                      <Badge variant="destructive" className="text-xs">
                        Low Stock
                      </Badge>
                    )}
                  </div>
                </div>
                {medicine.expiry_date && (
                  <div className="flex justify-between text-sm">
                    <span>Expires:</span>
                    <div className="flex items-center space-x-2">
                      <span className={isExpiringSoon(medicine.expiry_date) ? 'text-warning' : ''}>
                        {new Date(medicine.expiry_date).toLocaleDateString()}
                      </span>
                      {isExpiringSoon(medicine.expiry_date) && (
                        <Badge variant="destructive" className="text-xs">
                          Expiring Soon
                        </Badge>
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

      <AddMedicineDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        onMedicineAdded={handleMedicineAdded}
      />
    </div>
  );
}