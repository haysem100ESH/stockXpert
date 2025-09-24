import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { DollarSign, Package, ShoppingCart, AlertTriangle, Download, CalendarIcon, Calendar as CalendarDaysIcon } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from 'recharts';
import { format, subDays, subWeeks, subMonths, subYears, startOfDay, endOfDay } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import SubscriptionStatus from '@/components/subscription/SubscriptionStatus';

interface DashboardStats {
  totalRevenue: number;
  totalProducts: number;
  todaySales: number;
  lowStockItems: number;
  outOfStockItems: number;
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

interface PaymentMethodData {
  method: string;
  amount: number;
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

interface IncomeExpenseData {
  date: string;
  income: number;
  expenses: number;
}

export default function Dashboard() {
  const { profile } = useAuth();
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [stats, setStats] = useState<DashboardStats>({
    totalRevenue: 0,
    totalProducts: 0,
    todaySales: 0,
    lowStockItems: 0,
    outOfStockItems: 0,
    expiredItems: 0
  });
  const [outOfStockItems, setOutOfStockItems] = useState<OutOfStockItem[]>([]);
  const [lowStockItems, setLowStockItems] = useState<LowStockItem[]>([]);
  const [expiringItems, setExpiringItems] = useState<ExpiringItem[]>([]);
  const [expiredItems, setExpiredItems] = useState<ExpiredItem[]>([]);
  const [categorySales, setCategorySales] = useState<CategorySalesData[]>([]);
  const [productPerformance, setProductPerformance] = useState<ProductPerformanceData[]>([]);
  const [incomeExpenseData, setIncomeExpenseData] = useState<IncomeExpenseData[]>([]);
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
      
      // Fetch revenue for the selected period
      const { data: salesData } = await supabase
        .from('sales')
        .select('total_amount, created_at, payment_method, discount_amount')
        .gte('created_at', start.toISOString())
        .lte('created_at', end.toISOString());
      
      const totalRevenue = salesData?.reduce((sum, sale) => sum + Number(sale.total_amount), 0) || 0;

      // Fetch total products and stock info
      const { data: medicinesData } = await supabase
        .from('medicines')
        .select('stock_quantity, minimum_stock_level');

      const totalProducts = medicinesData?.length || 0;
      const lowStockItems = medicinesData?.filter(med => 
        med.stock_quantity <= med.minimum_stock_level && med.stock_quantity > 0
      ).length || 0;
      const outOfStockItems = medicinesData?.filter(med => med.stock_quantity === 0).length || 0;

      // Fetch sales for the selected period
      const { data: periodSalesData } = await supabase
        .from('sales')
        .select('id')
        .gte('created_at', start.toISOString())
        .lte('created_at', end.toISOString());

      const todaySales = periodSalesData?.length || 0;

      // Fetch out of stock items details
      const { data: outOfStockDetails } = await supabase
        .from('medicines')
        .select('id, name, category, stock_quantity')
        .eq('stock_quantity', 0);

      // Fetch low stock items details
      const { data: lowStockDetails } = await supabase
        .from('low_stock_medicines')
        .select('id, name, category, stock_quantity, minimum_stock_level');

      // Fetch expiring items (within 30 days)
      const thirtyDaysFromNow = new Date();
      thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
      const { data: expiringDetails } = await supabase
        .from('medicines')
        .select('id, name, category, expiry_date')
        .not('expiry_date', 'is', null)
        .lte('expiry_date', thirtyDaysFromNow.toISOString().split('T')[0])
        .gte('expiry_date', new Date().toISOString().split('T')[0]);

      // Fetch expired items
      const { data: expiredDetails, error: expiredError } = await supabase
        .from('medicines')
        .select('id, name, category, expiry_date')
        .not('expiry_date', 'is', null)
        .lte('expiry_date', new Date().toISOString().split('T')[0]);

      if (expiredError) {
        console.error('Error fetching expired medicines:', expiredError);
      } else {
        console.log('Expired medicines found:', expiredDetails?.length || 0);
      }

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

      // Fetch expenses for income vs expense chart
      const { data: expensesData } = await supabase
        .from('expenses')
        .select('amount, created_at')
        .gte('created_at', start.toISOString())
        .lte('created_at', end.toISOString());

      // Process income vs expense data by day
      const dateMap = new Map<string, { income: number; expenses: number }>();
      salesWithItems?.forEach(sale => {
        const date = format(new Date(sale.created_at), 'yyyy-MM-dd');
        const existing = dateMap.get(date) || { income: 0, expenses: 0 };
        dateMap.set(date, {
          ...existing,
          income: existing.income + Number(sale.total_amount)
        });
      });

      expensesData?.forEach(expense => {
        const date = format(new Date(expense.created_at), 'yyyy-MM-dd');
        const existing = dateMap.get(date) || { income: 0, expenses: 0 };
        dateMap.set(date, {
          ...existing,
          expenses: existing.expenses + Number(expense.amount)
        });
      });

      const incomeExpenseArray = Array.from(dateMap.entries())
        .map(([date, data]) => ({ date, ...data }))
        .sort((a, b) => a.date.localeCompare(b.date));

      // Process payment method data
      const paymentMap = new Map<string, number>();
      salesData?.forEach(sale => {
        const method = sale.payment_method || 'Cash';
        const amount = Number(sale.total_amount) - (Number(sale.discount_amount) || 0);
        paymentMap.set(method, (paymentMap.get(method) || 0) + amount);
      });

      const paymentMethodArray = Array.from(paymentMap.entries()).map(([method, amount]) => ({
        method: method,
        amount: amount
      }));

      setStats({
        totalRevenue,
        totalProducts,
        todaySales,
        lowStockItems,
        outOfStockItems,
        expiredItems: expiredDetails?.length || 0
      });
      setOutOfStockItems(outOfStockDetails || []);
      setLowStockItems(lowStockDetails || []);
      setExpiringItems(expiringDetails || []);
      setExpiredItems(expiredDetails || []);
      setCategorySales(categorySalesArray);
      setProductPerformance(productPerformanceArray);
      setIncomeExpenseData(incomeExpenseArray);
      setPaymentMethodData(paymentMethodArray);
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveExpiredItem = async (itemId: string) => {
    try {
      // Instead of deleting, set stock to 0 for expired medicines
      // This preserves sales history while removing from active inventory
      const { error } = await supabase
        .from('medicines')
        .update({ stock_quantity: 0 })
        .eq('id', itemId);

      if (error) throw error;

      // Remove from local state
      setExpiredItems(expiredItems.filter(item => item.id !== itemId));
      
      // Refresh dashboard data to update counts
      fetchDashboardData();
      
      // Show success message
      console.log('Expired medicine stock set to 0 successfully');
    } catch (error) {
      console.error('Error updating expired item:', error);
    }
  };

  const exportToCSV = () => {
    const csvContent = [
      ['Metric', 'Value'],
      ['Total Revenue', `ETB ${stats.totalRevenue.toFixed(2)}`],
      ['Total Products', stats.totalProducts.toString()],
      ['Today\'s Sales', stats.todaySales.toString()],
      ['Low Stock Items', stats.lowStockItems.toString()],
      ['Out of Stock Items', stats.outOfStockItems.toString()],
      [],
      ['Top Products'],
      ['Product Name', 'Sales Count', 'Revenue'],
      ...productPerformance.map(p => [p.name, p.sales.toString(), `ETB ${p.revenue.toFixed(2)}`])
    ].map(row => row.join(',')).join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pharmacy-dashboard-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  if (!profile) {
    return <div>Loading...</div>;
  }

  if (loading) {
    return <div>Loading dashboard...</div>;
  }

  const COLORS = [
    'hsl(217 91% 60%)',     // Blue
    'hsl(142 76% 36%)',     // Green  
    'hsl(38 92% 50%)',      // Orange
    'hsl(0 84% 60%)',       // Red
    'hsl(271 81% 56%)',     // Purple
    'hsl(191 95% 45%)',     // Cyan
    'hsl(49 96% 53%)',      // Yellow
    'hsl(340 82% 52%)',     // Pink
  ];

  return (
    <div className="space-y-6">
      {/* Subscription Status for Owners */}
      {profile?.role === 'owner' && (
        <SubscriptionStatus />
      )}
      
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
          <p className="text-muted-foreground">
            Welcome back, {profile.full_name}! Here's what's happening at your pharmacy.
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
        {profile?.role === 'owner' && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">ETB {stats.totalRevenue.toFixed(2)}</div>
              <p className="text-xs text-muted-foreground">All time revenue</p>
            </CardContent>
          </Card>
        )}
        
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
            <div className="text-2xl font-bold">{stats.todaySales}</div>
            <p className="text-xs text-muted-foreground">Sales transactions this period</p>
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

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Items Sold by Category */}
        <Card>
          <CardHeader>
            <CardTitle>Items Sold by Category</CardTitle>
            <CardDescription>Sales breakdown by medicine category</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer
              config={{
                sales: { label: "Sales", color: "hsl(217 91% 60%)" }
              }}
              className="h-[300px]"
            >
              <BarChart data={categorySales} width={533} height={300}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="category" />
                <YAxis />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="sales">
                  {categorySales.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* Payment Methods Pie Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Payment Methods</CardTitle>
            <CardDescription>Revenue breakdown by payment method</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer
              config={{
                amount: { label: "Amount", color: "hsl(142 76% 36%)" }
              }}
              className="h-[300px]"
            >
              <PieChart width={533} height={300}>
                <Pie
                  data={paymentMethodData}
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  fill="hsl(142 76% 36%)"
                  dataKey="amount"
                  label={(entry) => `${entry.method}: ETB ${entry.amount.toFixed(2)}`}
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

      {/* Top Selling Products Chart - Moved Below */}
      <Card>
        <CardHeader>
          <CardTitle>Top Selling Products</CardTitle>
          <CardDescription>Most frequently sold products</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer
            config={{
              sales: { label: "Sales", color: "hsl(38 92% 50%)" }
            }}
            className="h-[300px]"
          >
            <PieChart width={533} height={300}>
              <Pie
                data={productPerformance.slice(0, 5)}
                cx="50%"
                cy="50%"
                outerRadius={80}
                fill="hsl(38 92% 50%)"
                dataKey="sales"
                label={(entry) => entry.name}
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

      {/* Income vs Expenses Chart - Only show for owners */}
      {profile?.role === 'owner' && (
        <Card>
          <CardHeader>
            <CardTitle>Income vs Expenses</CardTitle>
            <CardDescription>Daily comparison of income and expenses</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer
              config={{
                income: { label: "Income", color: "hsl(var(--success))" },
                expenses: { label: "Expenses", color: "hsl(var(--destructive))" }
              }}
              className="h-[400px]"
            >
              <LineChart data={incomeExpenseData} width={533} height={400}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line 
                  type="monotone" 
                  dataKey="income" 
                  stroke="hsl(var(--success))" 
                  strokeWidth={2}
                />
                <Line 
                  type="monotone" 
                  dataKey="expenses" 
                  stroke="hsl(var(--destructive))" 
                  strokeWidth={2}
                />
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}