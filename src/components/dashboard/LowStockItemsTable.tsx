import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Package } from 'lucide-react';
import { supabase } from '@/lib/db';
import { useBranchContext } from '@/hooks/useBranchContext';
import { useAuth } from '@/hooks/useAuth';

interface LowStockItem {
  id: string;
  name: string;
  stock_quantity: number;
  minimum_stock_level: number;
}

export default function LowStockItemsTable() {
  const [lowStockItems, setLowStockItems] = useState<LowStockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const { selectedBranch } = useBranchContext();
  const { profile } = useAuth();

  useEffect(() => {
    fetchLowStockItems();
  }, [selectedBranch]);

  const fetchLowStockItems = async () => {
    try {
      // Owner isolation
      let ownerBranchIds: string[] = [];
      if (!selectedBranch && profile?.role === 'owner' && profile?.id) {
        const { data: ownerBranches } = await supabase
          .from('pharmacy_branches')
          .select('id')
          .eq('pharmacy_owner_id', profile.id);
        ownerBranchIds = (ownerBranches || []).map((b: any) => b.id);
      }

      if (!selectedBranch && ownerBranchIds.length === 0 && profile?.role === 'owner') {
        setLowStockItems([]);
        setLoading(false);
        return;
      }

      let query = supabase
        .from('medicines')
        .select('id, name, stock_quantity, minimum_stock_level')
        .gt('stock_quantity', 0);

      if (selectedBranch) {
        query = query.eq('branch_id', selectedBranch);
      } else if (ownerBranchIds.length > 0) {
        query = query.in('branch_id', ownerBranchIds);
      }

      const { data, error } = await query.order('stock_quantity', { ascending: true });

      if (error) throw error;

      const lowStock = (data || []).filter(item => 
        item.stock_quantity <= item.minimum_stock_level
      );

      setLowStockItems(lowStock);
    } catch (error) {
      console.error('Error fetching low stock items:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div>Loading low stock items...</div>;
  }

  if (lowStockItems.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <Package className="h-5 w-5 text-warning" />
          <span>Low Stock Items</span>
        </CardTitle>
        <CardDescription>
          {lowStockItems.length} items are running low on stock and need restocking
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
        <Table className="min-w-[500px]">
          <TableHeader>
            <TableRow>
              <TableHead>Medicine Name</TableHead>
              <TableHead>Available Quantity</TableHead>
              <TableHead>Threshold Limit</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lowStockItems.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-medium">{item.name}</TableCell>
                <TableCell>
                  <Badge variant="secondary" className="text-warning">
                    {item.stock_quantity}
                  </Badge>
                </TableCell>
                <TableCell>{item.minimum_stock_level}</TableCell>
                <TableCell>
                  <Badge variant="destructive">
                    Low Stock
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
      </CardContent>
    </Card>
  );
}