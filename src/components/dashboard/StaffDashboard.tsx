import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useBranchContext } from '@/hooks/useBranchContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Package, ShoppingCart, AlertTriangle, Download, CalendarIcon, Calendar as CalendarDaysIcon } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { format, startOfDay, endOfDay, subDays, subWeeks, subMonths, subYears } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import ExpiredMedicinesTable from './ExpiredMedicinesTable';
import LowStockItemsTable from './LowStockItemsTable';

interface DashboardStats {
  totalProducts: number;
  todaySales: number;
  lowStockItems: number;
  outOfStockItems: number;
  periodSalesRevenue: number;
  expiredItems: number;
}

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
}

interface ExpiredItem {
  id: string;
  name: string;
  category: string;
  expiry_date: string;
}

interface CategorySalesData {
  category: string;
  sales: number;
  revenue: number;
}

interface ProductPerformanceData {
  name: string;
  sales: number;
  revenue: number;
}

interface PaymentMethodData {
  method: string;
  amount: number;
}

export default function StaffDashboard() {
  const { profile } = useAuth();
  const { userBranch } = useBranchContext(); // Staff can only see their branch
  const [stats, setStats] = useState<DashboardStats>({
    totalProducts: 0,
    todaySales: 0,
    lowStockItems: 0,
    outOfStockItems: 0,
    periodSalesRevenue: 0,
    expiredItems: 0
  });
  const [outOfStockItems, setOutOfStockItems] = useState<OutOfStockItem[]>([]);
  const [lowStockItems, setLowStockItems] = useState<LowStockItem[]>([]);
  const [expiringItems, setExpiringItems] = useState<ExpiringItem[]>([]);
  const [expiredItems, setExpiredItems] = useState<ExpiredItem[]>([]);
  const [categorySales, setCategorySales] = useState<CategorySalesData[]>([]);
  const [productPerformance, setProductPerformance] = useState<ProductPerformanceData[]>([]);
  const [paymentMethodData, setPaymentMethodData] = useState<PaymentMethodData[]>([]);
  const [loading, setLoading] = useState(true);
  const [reportPeriod, setReportPeriod] = useState('monthly');
  const [customDate, setCustomDate] = useState<Date>();

  useEffect(() => {
    fetchDashboardData();
  }, [reportPeriod, customDate]);

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
      
      // Build queries with branch filtering for staff (only their branch)
      const medicinesResult = userBranch 
        ? await supabase.from('medicines').select('stock_quantity, minimum_stock_level').eq('branch_id', userBranch)
        : await supabase.from('medicines').select('stock_quantity, minimum_stock_level');
      
      const medicinesData = medicinesResult.data;

      const totalProducts = medicinesData?.length || 0;
      const lowStockItems = medicinesData?.filter(med => 
        med.stock_quantity <= med.minimum_stock_level && med.stock_quantity > 0
      ).length || 0;
      const outOfStockItems = medicinesData?.filter(med => med.stock_quantity === 0).length || 0;

      // Fetch sales for the selected period with branch filtering
      const salesResult = userBranch 
        ? await supabase
            .from('sales')
            .select('id, total_amount, payment_method, discount_amount')
            .gte('created_at', start.toISOString())
            .lte('created_at', end.toISOString())
            .eq('branch_id', userBranch)
        : await supabase
            .from('sales')
            .select('id, total_amount, payment_method, discount_amount')
            .gte('created_at', start.toISOString())
            .lte('created_at', end.toISOString());
      
      const periodSalesData = salesResult.data;

      const todaySales = periodSalesData?.length || 0;

      // Calculate period sales revenue 
      const periodSalesRevenue = periodSalesData?.reduce((sum, sale) => sum + Number(sale.total_amount), 0) || 0;

      // Fetch out of stock items details with branch filtering
      const outOfStockResult = userBranch 
        ? await supabase
            .from('medicines')
            .select('id, name, category, stock_quantity')
            .eq('stock_quantity', 0)
            .eq('branch_id', userBranch)
        : await supabase
            .from('medicines')
            .select('id, name, category, stock_quantity')
            .eq('stock_quantity', 0);
      
      const outOfStockDetails = outOfStockResult.data;

      // Fetch low stock items details with branch filtering
      const lowStockDetails = userBranch 
        ? await supabase
            .from('low_stock_medicines')
            .select('id, name, category, stock_quantity, minimum_stock_level')
            .eq('branch_id', userBranch)
        : await supabase
            .from('low_stock_medicines')
            .select('id, name, category, stock_quantity, minimum_stock_level');

      const lowStockData = lowStockDetails.data;

      // Fetch expiring items (within 30 days, excluding today)
      const thirtyDaysFromNow = new Date();
      thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const { data: expiringDetails } = await supabase
        .from('medicines')
        .select('id, name, category, expiry_date')
        .not('expiry_date', 'is', null)
        .lte('expiry_date', thirtyDaysFromNow.toISOString().split('T')[0])
        .gte('expiry_date', tomorrow.toISOString().split('T')[0]);

      // Fetch expired items
      const { data: expiredDetails } = await supabase
        .from('medicines')
        .select('id, name, category, expiry_date')
        .not('expiry_date', 'is', null)
        .lte('expiry_date', new Date().toISOString().split('T')[0]);

      // Fetch sales data with medicine details for charts
      const { data: salesWithItems } = await supabase
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

      // Process category sales data
      const categoryMap = new Map<string, { sales: number; revenue: number }>();
      salesWithItems?.forEach(sale => {
        sale.sale_items?.forEach((item: any) => {
          if (item.medicines) {
            const category = item.medicines.category;
            const existing = categoryMap.get(category) || { sales: 0, revenue: 0 };
            categoryMap.set(category, {
              sales: existing.sales + item.quantity,
              revenue: existing.revenue + (item.quantity * Number(sale.total_amount) / sale.sale_items.length)
            });
          }
        });
      });

      const categorySalesArray = Array.from(categoryMap.entries()).map(([category, data]) => ({
        category,
        ...data
      }));

      // Process product performance data
      const productMap = new Map<string, { sales: number; revenue: number }>();
      salesWithItems?.forEach(sale => {
        sale.sale_items?.forEach((item: any) => {
          if (item.medicines) {
            const name = item.medicines.name;
            const existing = productMap.get(name) || { sales: 0, revenue: 0 };
            productMap.set(name, {
              sales: existing.sales + item.quantity,
              revenue: existing.revenue + (item.quantity * Number(sale.total_amount) / sale.sale_items.length)
            });
          }
        });
      });

      const productPerformanceArray = Array.from(productMap.entries())
        .map(([name, data]) => ({ name, ...data }))
        .sort((a, b) => b.sales - a.sales)
        .slice(0, 10);

      // Process payment method data
      const paymentMap = new Map<string, number>();
      periodSalesData?.forEach(sale => {
        const method = sale.payment_method || 'Cash';
        const amount = Number(sale.total_amount) - (Number(sale.discount_amount) || 0);
        paymentMap.set(method, (paymentMap.get(method) || 0) + amount);
      });

      const paymentMethodArray = Array.from(paymentMap.entries()).map(([method, amount]) => ({
        method: method,
        amount: amount
      }));

      setStats({
        totalProducts,
        todaySales,
        lowStockItems,
        outOfStockItems,
        periodSalesRevenue,
        expiredItems: expiredDetails?.length || 0
      });
      setOutOfStockItems(outOfStockDetails || []);
      setLowStockItems(lowStockData || []);
      setExpiringItems(expiringDetails || []);
      setExpiredItems(expiredDetails || []);
      setCategorySales(categorySalesArray);
      setProductPerformance(productPerformanceArray);
      setPaymentMethodData(paymentMethodArray);
      
      // Store period sales revenue for the card display
      (window as any).periodSalesRevenue = periodSalesRevenue;
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveExpiredItem = async (itemId: string) => {
    try {
      // Set stock to 0 instead of deleting to preserve sales history
      const { error } = await supabase
        .from('medicines')
        .update({ stock_quantity: 0 })
        .eq('id', itemId);

      if (error) throw error;

      // Remove from local state
      setExpiredItems(expiredItems.filter(item => item.id !== itemId));
      
      // Refresh dashboard data to update counts
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
      ['Out of Stock Items', stats.outOfStockItems.toString()],
      [],
      ['Top Products'],
      ['Product Name', 'Sales Count'],
      ...productPerformance.map(p => [p.name, p.sales.toString()])
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

  const COLORS = ['hsl(var(--primary))', 'hsl(var(--secondary))', 'hsl(var(--accent))', 'hsl(var(--success))', 'hsl(var(--warning))'];

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
          
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-48 justify-start text-left font-normal">
                <CalendarIcon className="mr-2 h-4 w-4" />
                {customDate ? format(customDate, "PPP") : <span>Pick a date</span>}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0">
              <Calendar
                mode="single"
                selected={customDate}
                onSelect={setCustomDate}
                initialFocus
                className="p-3 pointer-events-auto"
              />
            </PopoverContent>
          </Popover>
          
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

      {/* Low Stock Items */}
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
                  <div className="text-right">
                    <Badge variant="secondary">{item.stock_quantity} left</Badge>
                    <p className="text-xs text-muted-foreground">Min: {item.minimum_stock_level}</p>
                  </div>
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

      {/* Expiring Items */}
      {expiringItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <CalendarDaysIcon className="h-5 w-5 text-warning" />
              <span>Items Expiring Soon</span>
            </CardTitle>
            <CardDescription>
              {expiringItems.length} items will expire within 30 days
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2">
              {expiringItems.slice(0, 5).map((item) => (
                <div key={item.id} className="flex items-center justify-between p-2 border rounded-lg">
                  <div>
                    <p className="font-medium">{item.name}</p>
                    <p className="text-sm text-muted-foreground">{item.category}</p>
                  </div>
                  <div className="text-right">
                    <Badge variant="outline">{new Date(item.expiry_date).toLocaleDateString()}</Badge>
                  </div>
                </div>
              ))}
              {expiringItems.length > 5 && (
                <p className="text-sm text-muted-foreground text-center">
                  And {expiringItems.length - 5} more items...
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Expired Items */}
      {expiredItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <CalendarDaysIcon className="h-5 w-5 text-destructive" />
              <span>Expired Items</span>
            </CardTitle>
            <CardDescription>
              {expiredItems.length} items have already expired
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2">
              {expiredItems.slice(0, 5).map((item) => (
                <div key={item.id} className="flex items-center justify-between p-2 bg-red-50 border rounded-lg">
                  <div>
                    <p className="font-medium">{item.name}</p>
                    <p className="text-sm text-muted-foreground">{item.category}</p>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Badge variant="destructive">{new Date(item.expiry_date).toLocaleDateString()}</Badge>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => handleRemoveExpiredItem(item.id)}
                    >
                      Remove
                    </Button>
                  </div>
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

      {/* Expired Medicines Table */}
      <ExpiredMedicinesTable />
      
      {/* Low Stock Items Table */}  
      <LowStockItemsTable />

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Items Sold by Category */}
        <Card>
          <CardHeader>
            <CardTitle>Items Sold by Category</CardTitle>
            <CardDescription>Sales breakdown by medicine category</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer
              config={{
                sales: { label: "Sales", color: "hsl(var(--primary))" }
              }}
              className="h-[300px]"
            >
              <BarChart data={categorySales} width={533} height={300}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="category" />
                <YAxis />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="sales" fill="hsl(var(--primary))" />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* Product Performance */}
        <Card>
          <CardHeader>
            <CardTitle>Top Selling Products</CardTitle>
            <CardDescription>Most frequently sold products</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer
              config={{
                sales: { label: "Sales", color: "hsl(var(--secondary))" }
              }}
              className="h-[300px]"
            >
               <PieChart width={533} height={300}>
                <Pie
                  data={productPerformance.slice(0, 5) as any[]}
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  fill="hsl(var(--secondary))"
                  dataKey="sales"
                  label={(entry: any) => entry.name}
                >
                  {productPerformance.slice(0, 5).map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <ChartTooltip content={<ChartTooltipContent />} />
              </PieChart>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* Payment Methods Pie Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Payment Methods</CardTitle>
            <CardDescription>Sales breakdown by payment method</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer
              config={{
                amount: { label: "Amount", color: "hsl(var(--primary))" }
              }}
              className="h-[300px]"
            >
               <PieChart width={533} height={300}>
                <Pie
                  data={paymentMethodData as any[]}
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  fill="hsl(var(--primary))"
                  dataKey="amount"
                  label={(entry: any) => `${entry.method}: ETB ${Number(entry.amount).toFixed(2)}`}
                >
                  {paymentMethodData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                   ))}
                 </Pie>
                 <ChartTooltip content={<ChartTooltipContent />} />
               </PieChart>
             </ChartContainer>
           </CardContent>
         </Card>
       </div>
     </div>
  );
}