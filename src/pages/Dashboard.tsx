import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { DollarSign, Package, ShoppingCart, AlertTriangle, TrendingUp, Download, CalendarIcon } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from 'recharts';
import { format, subDays, subWeeks, subMonths, subYears } from 'date-fns';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { supabase } from '@/integrations/supabase/client';

interface DashboardStats {
  totalRevenue: number;
  totalProducts: number;
  todaySales: number;
  lowStockItems: number;
  outOfStockItems: number;
}

interface OutOfStockItem {
  id: string;
  name: string;
  category: string;
  stock_quantity: number;
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
  const [stats, setStats] = useState<DashboardStats>({
    totalRevenue: 0,
    totalProducts: 0,
    todaySales: 0,
    lowStockItems: 0,
    outOfStockItems: 0
  });
  const [outOfStockItems, setOutOfStockItems] = useState<OutOfStockItem[]>([]);
  const [categorySales, setCategorySales] = useState<CategorySalesData[]>([]);
  const [productPerformance, setProductPerformance] = useState<ProductPerformanceData[]>([]);
  const [incomeExpenseData, setIncomeExpenseData] = useState<IncomeExpenseData[]>([]);
  const [loading, setLoading] = useState(true);
  const [reportPeriod, setReportPeriod] = useState('monthly');
  const [customDate, setCustomDate] = useState<Date>();

  useEffect(() => {
    fetchDashboardData();
  }, [reportPeriod, customDate]);

  const getDateRange = () => {
    const now = new Date();
    if (customDate) {
      const start = new Date(customDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(customDate);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    
    switch (reportPeriod) {
      case 'daily': return { start: subDays(now, 1), end: now };
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
        .select('total_amount, created_at')
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

      setStats({
        totalRevenue,
        totalProducts,
        todaySales,
        lowStockItems,
        outOfStockItems
      });
      setOutOfStockItems(outOfStockDetails || []);
      setCategorySales(categorySalesArray);
      setProductPerformance(productPerformanceArray);
      setIncomeExpenseData(incomeExpenseArray);
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const exportToPDF = () => {
    const doc = new jsPDF();
    
    doc.setFontSize(20);
    doc.text('Pharmacy Dashboard Report', 20, 20);
    
    doc.setFontSize(12);
    const periodText = customDate 
      ? `Custom Date: ${format(customDate, 'PPP')}`
      : `Period: ${reportPeriod.charAt(0).toUpperCase() + reportPeriod.slice(1)}`;
    doc.text(periodText, 20, 35);
    doc.text(`Generated: ${format(new Date(), 'PPP')}`, 20, 45);
    
    // Stats table
    const statsData = [
      ['Total Revenue', `$${stats.totalRevenue.toFixed(2)}`],
      ['Total Products', stats.totalProducts.toString()],
      [customDate ? 'Selected Date Sales' : 'Period Sales', stats.todaySales.toString()],
      ['Low Stock Items', stats.lowStockItems.toString()],
      ['Out of Stock Items', stats.outOfStockItems.toString()]
    ];
    
    // Add chart data to PDF
    const categoryData = categorySales.map(cat => [cat.category, cat.sales.toString(), `$${cat.revenue.toFixed(2)}`]);
    const productData = productPerformance.slice(0, 5).map(prod => [prod.name, prod.sales.toString(), `$${prod.revenue.toFixed(2)}`]);
    
    (doc as any).autoTable({
      head: [['Metric', 'Value']],
      body: statsData,
      startY: 60,
      theme: 'grid'
    });
    
    // Add category sales table
    if (categoryData.length > 0) {
      (doc as any).autoTable({
        head: [['Category', 'Items Sold', 'Revenue']],
        body: categoryData,
        startY: (doc as any).lastAutoTable.finalY + 20,
        theme: 'grid'
      });
    }
    
    // Add top products table
    if (productData.length > 0) {
      (doc as any).autoTable({
        head: [['Product', 'Items Sold', 'Revenue']],
        body: productData,
        startY: (doc as any).lastAutoTable.finalY + 20,
        theme: 'grid'
      });
    }
    
    const filename = customDate 
      ? `pharmacy-dashboard-${format(customDate, 'yyyy-MM-dd')}.pdf`
      : `pharmacy-dashboard-${reportPeriod}-${format(new Date(), 'yyyy-MM-dd')}.pdf`;
    
    doc.save(filename);
  };

  const exportToCSV = () => {
    const csvContent = [
      ['Metric', 'Value'],
      ['Total Revenue', `$${stats.totalRevenue.toFixed(2)}`],
      ['Total Products', stats.totalProducts.toString()],
      ['Today\'s Sales', stats.todaySales.toString()],
      ['Low Stock Items', stats.lowStockItems.toString()],
      ['Out of Stock Items', stats.outOfStockItems.toString()],
      [],
      ['Top Products'],
      ['Product Name', 'Sales Count', 'Revenue'],
      ...productPerformance.map(p => [p.name, p.sales.toString(), `$${p.revenue.toFixed(2)}`])
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

  const COLORS = ['hsl(var(--primary))', 'hsl(var(--secondary))', 'hsl(var(--accent))', 'hsl(var(--success))', 'hsl(var(--warning))'];

  return (
    <div className="space-y-6">
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
          
          <Button onClick={exportToPDF} variant="outline">
            <Download className="h-4 w-4 mr-2" />
            PDF
          </Button>
          
          <Button onClick={exportToCSV} variant="outline">
            <Download className="h-4 w-4 mr-2" />
            CSV
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${stats.totalRevenue.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground">All time revenue</p>
          </CardContent>
        </Card>
        
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
            <CardTitle className="text-sm font-medium">Today's Sales</CardTitle>
            <ShoppingCart className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.todaySales}</div>
            <p className="text-xs text-muted-foreground">Sales transactions today</p>
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
                sales: { label: "Sales", color: "hsl(var(--primary))" }
              }}
              className="h-[300px]"
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={categorySales}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="category" />
                  <YAxis />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="sales" fill="hsl(var(--primary))" />
                </BarChart>
              </ResponsiveContainer>
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
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={productPerformance.slice(0, 5)}
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    fill="hsl(var(--secondary))"
                    dataKey="sales"
                    label={(entry) => entry.name}
                  >
                    {productPerformance.slice(0, 5).map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <ChartTooltip content={<ChartTooltipContent />} />
                </PieChart>
              </ResponsiveContainer>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      {/* Income vs Expenses Chart */}
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
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={incomeExpenseData}>
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
            </ResponsiveContainer>
          </ChartContainer>
        </CardContent>
      </Card>
    </div>
  );
}