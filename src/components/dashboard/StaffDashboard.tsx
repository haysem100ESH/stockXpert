import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useBranchContext } from '@/hooks/useBranchContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Package, ShoppingCart, AlertTriangle, Download, Calendar as CalendarDaysIcon } from 'lucide-react';
import { format, startOfDay, endOfDay, subWeeks, subMonths, subYears } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';

// Use explicit types with type assertions to avoid complex inference
type SimpleStats = {
  totalProducts: number;
  todaySales: number;
  lowStockItems: number;
  outOfStockItems: number;
  periodSalesRevenue: number;
  expiredItems: number;
};

type SimpleItem = {
  id: string;
  name: string;
  category: string;
  stock_quantity?: number;
  minimum_stock_level?: number;
  expiry_date?: string;
};

export default function StaffDashboard() {
  const { profile } = useAuth();
  const { userBranch } = useBranchContext();
  
  const [stats, setStats] = useState<SimpleStats>({
    totalProducts: 0,
    todaySales: 0,
    lowStockItems: 0,
    outOfStockItems: 0,
    periodSalesRevenue: 0,
    expiredItems: 0
  });
  
  const [outOfStockItems, setOutOfStockItems] = useState<SimpleItem[]>([]);
  const [lowStockItems, setLowStockItems] = useState<SimpleItem[]>([]);
  const [expiringItems, setExpiringItems] = useState<SimpleItem[]>([]);
  const [expiredItems, setExpiredItems] = useState<SimpleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [reportPeriod, setReportPeriod] = useState('monthly');
  const [customDate, setCustomDate] = useState<Date>();

  useEffect(() => {
    fetchDashboardData();
  }, [reportPeriod, customDate, userBranch]);

  const getDateRange = () => {
    const now = new Date();
    if (customDate) {
      return { 
        start: startOfDay(customDate), 
        end: endOfDay(customDate) 
      };
    }
    
    switch (reportPeriod) {
      case 'daily': return { start: startOfDay(now), end: endOfDay(now) };
      case 'weekly': return { start: subWeeks(now, 1), end: now };
      case 'monthly': return { start: subMonths(now, 1), end: now };
      case 'yearly': return { start: subYears(now, 1), end: now };
      default: return { start: subMonths(now, 1), end: now };
    }
  };

  const fetchDashboardData = async () => {
    try {
      const { start, end } = getDateRange();
      
      // Use explicit any types to bypass complex inference
      let medicinesQuery = supabase
        .from('medicines')
        .select('stock_quantity, minimum_stock_level');
      
      if (userBranch) {
        medicinesQuery = medicinesQuery.eq('branch_id', userBranch);
      }
      
      const medicinesResult = await medicinesQuery;
      const medicinesData = medicinesResult.data as any[] || [];

      let salesQuery = supabase
        .from('sales')
        .select('id, total_amount, payment_method, discount_amount')
        .gte('created_at', start.toISOString())
        .lte('created_at', end.toISOString());
      
      if (userBranch) {
        salesQuery = salesQuery.eq('branch_id', userBranch);
      }
      
      const salesResult = await salesQuery;
      const salesData = salesResult.data as any[] || [];

      let outOfStockQuery = supabase
        .from('medicines')
        .select('id, name, category, stock_quantity')
        .eq('stock_quantity', 0);
      
      if (userBranch) {
        outOfStockQuery = outOfStockQuery.eq('branch_id', userBranch);
      }
      
      const outOfStockResult = await outOfStockQuery;
      const outOfStockData = outOfStockResult.data as SimpleItem[] || [];

      // For low stock items, query medicines directly since we need branch filtering
      let lowStockQuery = supabase
        .from('medicines')
        .select('id, name, category, stock_quantity, minimum_stock_level')
        .gt('stock_quantity', 0);
      
      if (userBranch) {
        lowStockQuery = lowStockQuery.eq('branch_id', userBranch);
      }
      
      const lowStockResult = await lowStockQuery;
      const allMedicines = lowStockResult.data as SimpleItem[] || [];
      
      // Filter low stock items client-side
      const lowStockData = allMedicines.filter(med => 
        med.stock_quantity && med.minimum_stock_level && 
        med.stock_quantity <= med.minimum_stock_level
      );

      const thirtyDaysFromNow = new Date();
      thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      let expiringQuery = supabase
        .from('medicines')
        .select('id, name, category, expiry_date')
        .not('expiry_date', 'is', null)
        .lte('expiry_date', thirtyDaysFromNow.toISOString().split('T')[0])
        .gte('expiry_date', tomorrow.toISOString().split('T')[0]);
      
      if (userBranch) {
        expiringQuery = expiringQuery.eq('branch_id', userBranch);
      }
      
      const expiringResult = await expiringQuery;
      const expiringData = expiringResult.data as SimpleItem[] || [];

      let expiredQuery = supabase
        .from('medicines')
        .select('id, name, category, expiry_date')
        .not('expiry_date', 'is', null)
        .lte('expiry_date', new Date().toISOString().split('T')[0]);
      
      if (userBranch) {
        expiredQuery = expiredQuery.eq('branch_id', userBranch);
      }
      
      const expiredResult = await expiredQuery;
      const expiredData = expiredResult.data as SimpleItem[] || [];

      const totalProducts = medicinesData.length;
      const lowStockItemsCount = medicinesData.filter((med: any) => 
        med.stock_quantity <= med.minimum_stock_level && med.stock_quantity > 0
      ).length;
      const outOfStockItemsCount = medicinesData.filter((med: any) => med.stock_quantity === 0).length;
      const periodSalesRevenue = salesData.reduce((sum: number, sale: any) => sum + Number(sale.total_amount), 0);

      setStats({
        totalProducts,
        todaySales: salesData.length,
        lowStockItems: lowStockItemsCount,
        outOfStockItems: outOfStockItemsCount,
        periodSalesRevenue,
        expiredItems: expiredData.length
      });
      
      setOutOfStockItems(outOfStockData);
      setLowStockItems(lowStockData);
      setExpiringItems(expiringData);
      setExpiredItems(expiredData);
      
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveExpiredItem = async (itemId: string) => {
    try {
      const { error } = await supabase
        .from('medicines')
        .update({ stock_quantity: 0 })
        .eq('id', itemId);

      if (error) throw error;

      setExpiredItems(expiredItems.filter(item => item.id !== itemId));
      fetchDashboardData();
    } catch (error) {
      console.error('Error updating expired item:', error);
    }
  };

  const exportToCSV = () => {
    const csvContent = [
      ['Metric', 'Value'],
      ['Total Products', stats.totalProducts.toString()],
      ['Period Sales', stats.todaySales.toString()],
      ['Low Stock Items', stats.lowStockItems.toString()],
      ['Out of Stock Items', stats.outOfStockItems.toString()]
    ].map(row => row.join(',')).join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `staff-dashboard-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  if (!profile) {
    return <div>Loading...</div>;
  }

  if (loading) {
    return <div>Loading dashboard...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Staff Dashboard</h2>
          <p className="text-muted-foreground">
            Welcome back, {profile.full_name}! Here's what's happening today.
          </p>
        </div>
        
        <div className="flex items-center space-x-4">
          <Select value={reportPeriod} onValueChange={setReportPeriod}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">Daily</SelectItem>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="monthly">Monthly</SelectItem>
              <SelectItem value="yearly">Yearly</SelectItem>
            </SelectContent>
          </Select>
          
          <Button onClick={exportToCSV} variant="outline">
            <Download className="h-4 w-4 mr-2" />
            CSV
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Products</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalProducts}</div>
            <p className="text-xs text-muted-foreground">Products in inventory</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Period Sales</CardTitle>
            <ShoppingCart className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">ETB {stats.periodSalesRevenue.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground">Sales revenue this period</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Stock Alerts</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-warning">{stats.lowStockItems}</div>
            <p className="text-xs text-muted-foreground">Low stock items</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Out of Stock</CardTitle>
            <Package className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{stats.outOfStockItems}</div>
            <p className="text-xs text-muted-foreground">Items out of stock</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Expiring Soon</CardTitle>
            <CalendarDaysIcon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-warning">{expiringItems.length}</div>
            <p className="text-xs text-muted-foreground">Items expiring in 30 days</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Expired Medicines</CardTitle>
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{stats.expiredItems}</div>
            <p className="text-xs text-muted-foreground">Medicines expired</p>
          </CardContent>
        </Card>
      </div>

      {stats.outOfStockItems > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <span>Out of Stock Products</span>
            </CardTitle>
            <CardDescription>
              {stats.outOfStockItems} products are currently out of stock
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2">
              {outOfStockItems.slice(0, 5).map((item) => (
                <div key={item.id} className="flex items-center justify-between p-2 border rounded-lg">
                  <div>
                    <p className="font-medium">{item.name}</p>
                    <p className="text-sm text-muted-foreground">{item.category}</p>
                  </div>
                  <Badge variant="destructive">Out of Stock</Badge>
                </div>
              ))}
              {outOfStockItems.length > 5 && (
                <p className="text-sm text-muted-foreground text-center">
                  And {outOfStockItems.length - 5} more items...
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {lowStockItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Package className="h-5 w-5 text-warning" />
              <span>Low Stock Items</span>
            </CardTitle>
            <CardDescription>
              {lowStockItems.length} items are running low on stock
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2">
              {lowStockItems.slice(0, 5).map((item) => (
                <div key={item.id} className="flex items-center justify-between p-2 border rounded-lg">
                  <div>
                    <p className="font-medium">{item.name}</p>
                    <p className="text-sm text-muted-foreground">{item.category}</p>
                  </div>
                  <Badge variant="outline">Low Stock</Badge>
                </div>
              ))}
              {lowStockItems.length > 5 && (
                <p className="text-sm text-muted-foreground text-center">
                  And {lowStockItems.length - 5} more items...
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {expiredItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <span>Expired Medicines</span>
            </CardTitle>
            <CardDescription>
              {expiredItems.length} medicines have expired and need attention
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2">
              {expiredItems.slice(0, 5).map((item) => (
                <div key={item.id} className="flex items-center justify-between p-2 border rounded-lg">
                  <div>
                    <p className="font-medium">{item.name}</p>
                    <p className="text-sm text-muted-foreground">Expires: {item.expiry_date}</p>
                  </div>
                  <Button 
                    variant="destructive" 
                    size="sm"
                    onClick={() => handleRemoveExpiredItem(item.id)}
                  >
                    Remove
                  </Button>
                </div>
              ))}
              {expiredItems.length > 5 && (
                <p className="text-sm text-muted-foreground text-center">
                  And {expiredItems.length - 5} more items...
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}