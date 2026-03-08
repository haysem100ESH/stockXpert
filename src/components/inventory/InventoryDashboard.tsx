import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Package, CalendarDays } from 'lucide-react';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { useBranchContext } from '@/hooks/useBranchContext';
import { useAuth } from '@/hooks/useAuth';

interface OutOfStockItem {
  id: string;
  name: string;
  category: string;
  stock_quantity: number;
}

interface LowStockItem {
  id: string;
  name: string;
  category: string;
  stock_quantity: number;
  minimum_stock_level: number;
}

interface ExpiringItem {
  id: string;
  name: string;
  category: string;
  expiry_date: string;
  stock_quantity: number;
}

interface ExpiredItem {
  id: string;
  name: string;
  category: string;
  expiry_date: string;
  stock_quantity: number;
}

export default function InventoryDashboard() {
  const [outOfStockItems, setOutOfStockItems] = useState<OutOfStockItem[]>([]);
  const [lowStockItems, setLowStockItems] = useState<LowStockItem[]>([]);
  const [expiringItems, setExpiringItems] = useState<ExpiringItem[]>([]);
  const [expiredItems, setExpiredItems] = useState<ExpiredItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    open: boolean;
    medicineId: string;
    medicineName: string;
  }>({
    open: false,
    medicineId: '',
    medicineName: ''
  });
  const { toast } = useToast();
  const { selectedBranch, branchType } = useBranchContext();
  const { profile } = useAuth();
  const isPharmacy = branchType === 'pharmacy';

  useEffect(() => {
    fetchInventoryData();
  }, [selectedBranch]);

  // Set up real-time subscription for medicines table changes
  useEffect(() => {
    const channel = supabase
      .channel('inventory-changes')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'medicines'
        },
        (payload) => {
          console.log('Medicine updated:', payload);
          // Refresh inventory data when medicines are updated
          fetchInventoryData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchInventoryData = async () => {
    try {
      // Owner isolation: fetch owner's branch IDs when "All Branches"
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
        setOutOfStockItems([]); setLowStockItems([]); setExpiringItems([]); setExpiredItems([]);
        setLoading(false);
        return;
      }

      // Fetch out of stock items
      let outOfStockQuery = supabase
        .from('medicines')
        .select('id, name, category, stock_quantity')
        .eq('stock_quantity', 0);
      
      if (selectedBranch) {
        outOfStockQuery = outOfStockQuery.eq('branch_id', selectedBranch);
      } else if (ownerBranchIds.length > 0) {
        outOfStockQuery = outOfStockQuery.in('branch_id', ownerBranchIds);
      }

      const { data: outOfStockDetails } = await outOfStockQuery;

      // Fetch low stock items
      let lowStockDirectQuery = supabase
        .from('medicines')
        .select('id, name, category, stock_quantity, minimum_stock_level')
        .gt('stock_quantity', 0);
      
      if (selectedBranch) {
        lowStockDirectQuery = lowStockDirectQuery.eq('branch_id', selectedBranch);
      } else if (ownerBranchIds.length > 0) {
        lowStockDirectQuery = lowStockDirectQuery.in('branch_id', ownerBranchIds);
      }

      const { data: allMedicines } = await lowStockDirectQuery;
      
      // Filter low stock items client-side
      const lowStockDetails = allMedicines?.filter(med => 
        med.stock_quantity <= med.minimum_stock_level
      ) || [];

      // Only fetch expiry data for pharmacy branches
      let expiringDetails: ExpiringItem[] = [];
      let expiredDetails: ExpiredItem[] = [];
      
      if (isPharmacy) {
        const thirtyDaysFromNow = new Date();
        thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        
        let expiringQuery = supabase
          .from('medicines')
          .select('id, name, category, expiry_date, stock_quantity')
          .not('expiry_date', 'is', null)
          .lte('expiry_date', thirtyDaysFromNow.toISOString().split('T')[0])
          .gte('expiry_date', tomorrow.toISOString().split('T')[0])
          .gt('stock_quantity', 0);
        
        if (selectedBranch) {
          expiringQuery = expiringQuery.eq('branch_id', selectedBranch);
        } else if (ownerBranchIds.length > 0) {
          expiringQuery = expiringQuery.in('branch_id', ownerBranchIds);
        }

        const { data: expiringData } = await expiringQuery;
        expiringDetails = expiringData || [];

        let expiredQuery = supabase
          .from('medicines')
          .select('id, name, category, expiry_date, stock_quantity')
          .not('expiry_date', 'is', null)
          .lte('expiry_date', new Date().toISOString().split('T')[0])
          .gt('stock_quantity', 0);
        
        if (selectedBranch) {
          expiredQuery = expiredQuery.eq('branch_id', selectedBranch);
        } else if (ownerBranchIds.length > 0) {
          expiredQuery = expiredQuery.in('branch_id', ownerBranchIds);
        }

        const { data: expiredData } = await expiredQuery;
        expiredDetails = expiredData || [];
      }

      setOutOfStockItems(outOfStockDetails || []);
      setLowStockItems(lowStockDetails || []);
      setExpiringItems(expiringDetails);
      setExpiredItems(expiredDetails || []);
    } catch (error) {
      console.error('Error fetching inventory data:', error);
      toast({
        title: "Error",
        description: "Failed to fetch inventory data",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveExpiredItem = (itemId: string, itemName: string) => {
    setDeleteConfirm({
      open: true,
      medicineId: itemId,
      medicineName: itemName
    });
  };

  const confirmRemoveExpiredItem = async () => {
    try {
      // Set stock to 0 and clear expiry date for expired medicines
      const { error } = await supabase
        .from('medicines')
        .update({ 
          stock_quantity: 0,
          expiry_date: null
        })
        .eq('id', deleteConfirm.medicineId);

      if (error) throw error;

      // Remove from local state immediately for better UX
      setExpiredItems(expiredItems.filter(item => item.id !== deleteConfirm.medicineId));
      
      toast({
        title: "Success",
        description: "Expired item stock set to 0 and expiry date cleared",
      });

      setDeleteConfirm({ open: false, medicineId: '', medicineName: '' });
    } catch (error) {
      console.error('Error updating expired item:', error);
      toast({
        title: "Error",
        description: "Failed to update expired item",
        variant: "destructive"
      });
    }
  };

  if (loading) {
    return <div>Loading inventory data...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Out of Stock Items */}
      {outOfStockItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Package className="h-5 w-5 text-destructive" />
              <span>Out of Stock Products</span>
            </CardTitle>
            <CardDescription>
              {outOfStockItems.length} products are currently out of stock
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2">
              {outOfStockItems.map((item) => (
                <div key={item.id} className="flex items-center justify-between p-2 border rounded-lg">
                  <div>
                    <p className="font-medium">{item.name}</p>
                    <p className="text-sm text-muted-foreground">{item.category}</p>
                  </div>
                  <Badge variant="destructive">Out of Stock</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Low Stock Items */}
      {lowStockItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <AlertTriangle className="h-5 w-5 text-warning" />
              <span>Low Stock Items</span>
            </CardTitle>
            <CardDescription>
              {lowStockItems.length} items are running low on stock
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2">
              {lowStockItems.map((item) => (
                <div key={item.id} className="flex items-center justify-between p-2 border rounded-lg">
                  <div>
                    <p className="font-medium">{item.name}</p>
                    <p className="text-sm text-muted-foreground">{item.category}</p>
                  </div>
                  <div className="text-right">
                    <Badge variant="secondary">{item.stock_quantity} left</Badge>
                    <p className="text-xs text-muted-foreground">Min: {item.minimum_stock_level}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Items Expiring Soon */}
      {expiringItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <CalendarDays className="h-5 w-5 text-warning" />
              <span>Items Expiring Soon</span>
            </CardTitle>
            <CardDescription>
              {expiringItems.length} items will expire within 30 days
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2">
              {expiringItems.map((item) => (
                <div key={item.id} className="flex items-center justify-between p-2 border rounded-lg">
                  <div>
                    <p className="font-medium">{item.name}</p>
                    <p className="text-sm text-muted-foreground">{item.category}</p>
                  </div>
                  <div className="text-right">
                    <Badge variant="secondary">{item.stock_quantity} in stock</Badge>
                    <p className="text-xs text-warning">
                      Expires: {new Date(item.expiry_date).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Expired Medicines */}
      {expiredItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <span>Expired Medicines</span>
            </CardTitle>
            <CardDescription>
              {expiredItems.length} medicines have expired and should be removed
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2">
              {expiredItems.map((item) => (
                <div key={item.id} className="flex items-center justify-between p-2 border rounded-lg bg-red-50">
                  <div>
                    <p className="font-medium">{item.name}</p>
                    <p className="text-sm text-muted-foreground">{item.category}</p>
                    <p className="text-xs text-destructive">
                      Expired: {new Date(item.expiry_date).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Badge variant="destructive">Expired</Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleRemoveExpiredItem(item.id, item.name)}
                      className="text-destructive hover:text-destructive"
                    >
                      Set Stock to 0
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty States */}
      {outOfStockItems.length === 0 && lowStockItems.length === 0 && 
       expiringItems.length === 0 && expiredItems.length === 0 && (
        <Card>
          <CardContent className="text-center py-8">
            <Package className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">All Good!</h3>
            <p className="text-muted-foreground">
              No inventory issues detected. All products are well-stocked{isPharmacy ? ' and within expiry dates' : ''}.
            </p>
          </CardContent>
        </Card>
      )}

      <ConfirmationDialog
        open={deleteConfirm.open}
        onOpenChange={(open) => setDeleteConfirm(prev => ({ ...prev, open }))}
        title="Set Stock to Zero"
        description={`Are you sure you want to set the stock of "${deleteConfirm.medicineName}" to 0? This will remove it from active inventory while preserving sales history.`}
        onConfirm={confirmRemoveExpiredItem}
        confirmText="Set to 0"
        cancelText="Cancel"
      />
    </div>
  );
}
