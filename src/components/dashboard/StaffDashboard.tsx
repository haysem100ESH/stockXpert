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
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

// Use explicit types with type assertions to avoid complex inference
type SimpleStats = {
  totalProducts: number;
  totalMedicines: number;
  totalItems: number;
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

type CategorySalesData = {
  category: string;
  sales: number;
  revenue: number;
};

type ProductData = {
  name: string;
  sales: number;
  revenue: number;
};

export default function StaffDashboard() {
  const { profile } = useAuth();
  const { userBranch } = useBranchContext();
  
  const [stats, setStats] = useState<SimpleStats>({
    totalProducts: 0,
    totalMedicines: 0,
    totalItems: 0,
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
  const [medicinesCategorySales, setMedicinesCategorySales] = useState<CategorySalesData[]>([]);
  const [itemsCategorySales, setItemsCategorySales] = useState<CategorySalesData[]>([]);
  const [topMedicines, setTopMedicines] = useState<ProductData[]>([]);
  const [topItems, setTopItems] = useState<ProductData[]>([]);
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
      const medicineCategories = ['tablet', 'capsule', 'syrup', 'injection', 'cream', 'ointment', 'drops', 'inhaler'];
      
      // Use explicit any types to bypass complex inference
      let medicinesQuery = supabase
        .from('medicines')
        .select('stock_quantity, minimum_stock_level, category');
      
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

      // Fetch sales with items for charts
      let salesWithItemsQuery = supabase
        .from('sales')
        .select(`
          *,
          sale_items (
            quantity,
            medicine_id,
            medicines (name, category)
          )
        `)
        .gte('created_at', start.toISOString())
        .lte('created_at', end.toISOString());
      
      if (userBranch) {
        salesWithItemsQuery = salesWithItemsQuery.eq('branch_id', userBranch);
      }
      
      const { data: salesWithItems } = await salesWithItemsQuery;

      // Process category sales data
      const medicineCategoryMap = new Map<string, { sales: number; revenue: number }>();
      const itemCategoryMap = new Map<string, { sales: number; revenue: number }>();
      
      salesWithItems?.forEach((sale: any) => {
        sale.sale_items?.forEach((item: any) => {
          if (item.medicines) {
            const category = item.medicines.category;
            const isMedicine = medicineCategories.includes(category);
            const itemRevenue = (Number(sale.total_amount) * item.quantity) / 
              (sale.sale_items?.reduce((sum: number, si: any) => sum + si.quantity, 0) || 1);

            if (isMedicine) {
              const medExisting = medicineCategoryMap.get(category) || { sales: 0, revenue: 0 };
              medicineCategoryMap.set(category, {
                sales: medExisting.sales + item.quantity,
                revenue: medExisting.revenue + itemRevenue
              });
            } else {
              const itemExisting = itemCategoryMap.get(category) || { sales: 0, revenue: 0 };
              itemCategoryMap.set(category, {
                sales: itemExisting.sales + item.quantity,
                revenue: itemExisting.revenue + itemRevenue
              });
            }
          }
        });
      });

      const medicinesCategorySalesArray = Array.from(medicineCategoryMap.entries()).map(([category, data]) => ({
        category,
        ...data
      }));

      const itemsCategorySalesArray = Array.from(itemCategoryMap.entries()).map(([category, data]) => ({
        category,
        ...data
      }));

      // Process product performance
      const productMap = new Map<string, { sales: number; revenue: number; category: string }>();
      salesWithItems?.forEach((sale: any) => {
        sale.sale_items?.forEach((item: any) => {
          if (item.medicines) {
            const name = item.medicines.name;
            const category = item.medicines.category;
            const existing = productMap.get(name) || { sales: 0, revenue: 0, category };
            const itemRevenue = (Number(sale.total_amount) * item.quantity) / 
              (sale.sale_items?.reduce((sum: number, si: any) => sum + si.quantity, 0) || 1);
            productMap.set(name, {
              sales: existing.sales + item.quantity,
              revenue: existing.revenue + itemRevenue,
              category
            });
          }
        });
      });

      const topMedicinesArray = Array.from(productMap.entries())
        .filter(([_, data]) => medicineCategories.includes(data.category))
        .map(([name, data]) => ({ name, sales: data.sales, revenue: data.revenue }))
        .sort((a, b) => b.sales - a.sales)
        .slice(0, 10);

      const topItemsArray = Array.from(productMap.entries())
        .filter(([_, data]) => !medicineCategories.includes(data.category))
        .map(([name, data]) => ({ name, sales: data.sales, revenue: data.revenue }))
        .sort((a, b) => b.sales - a.sales)
        .slice(0, 10);

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
      const totalMedicines = medicinesData.filter((med: any) => medicineCategories.includes(med.category)).length;
      const totalItems = medicinesData.filter((med: any) => !medicineCategories.includes(med.category)).length;
      const lowStockItemsCount = medicinesData.filter((med: any) => 
        med.stock_quantity <= med.minimum_stock_level && med.stock_quantity > 0
      ).length;
      const outOfStockItemsCount = medicinesData.filter((med: any) => med.stock_quantity === 0).length;
      const periodSalesRevenue = salesData.reduce((sum: number, sale: any) => sum + Number(sale.total_amount), 0);

      setStats({
        totalProducts,
        totalMedicines,
        totalItems,
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
      setMedicinesCategorySales(medicinesCategorySalesArray);
      setItemsCategorySales(itemsCategorySalesArray);
      setTopMedicines(topMedicinesArray);
      setTopItems(topItemsArray);
      
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

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Medicines</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalMedicines}</div>
            <p className="text-xs text-muted-foreground">Medicines in stock</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Items</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalItems}</div>
            <p className="text-xs text-muted-foreground">Non-medicine items</p>
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

      {/* Analytics Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Medicines Sold by Category */}
        <Card>
          <CardHeader>
            <CardTitle>Medicines Sold by Category</CardTitle>
            <CardDescription>Medicine sales performance</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={medicinesCategorySales}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="category" />
                <YAxis />
                <Bar dataKey="sales" fill="hsl(var(--primary))" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Items Sold by Category */}
        <Card>
          <CardHeader>
            <CardTitle>Items Sold by Category</CardTitle>
            <CardDescription>Non-medicine items sales</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={itemsCategorySales}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="category" />
                <YAxis />
                <Bar dataKey="sales" fill="hsl(var(--secondary))" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Top-Selling Medicines */}
        <Card>
          <CardHeader>
            <CardTitle>Top-Selling Medicines</CardTitle>
            <CardDescription>Best performing medicines</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={topMedicines.slice(0, 5)}
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  fill="hsl(var(--primary))"
                  dataKey="sales"
                  label={(entry: any) => entry.name}
                >
                  {topMedicines.slice(0, 5).map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={`hsl(${(index * 72) % 360}, 70%, 50%)`} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Top-Selling Items */}
        <Card>
          <CardHeader>
            <CardTitle>Top-Selling Items</CardTitle>
            <CardDescription>Best performing items</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={topItems.slice(0, 5)}
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  fill="hsl(var(--accent))"
                  dataKey="sales"
                  label={(entry: any) => entry.name}
                >
                  {topItems.slice(0, 5).map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={`hsl(${(index * 90) % 360}, 65%, 55%)`} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}