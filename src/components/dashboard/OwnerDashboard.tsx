import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  DollarSign, 
  Package, 
  TrendingUp, 
  AlertTriangle,
  Plus,
  Users,
  FileText,
  ShoppingCart
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import InventoryManagement from '@/components/inventory/InventoryManagement';
import SalesManagement from '@/components/sales/SalesManagement';
import FinanceManagement from '@/components/finance/FinanceManagement';
import SupplierManagement from '@/components/suppliers/SupplierManagement';
import StaffManagement from '@/components/staff/StaffManagement';
import ExpiredMedicinesTable from './ExpiredMedicinesTable';
import LowStockItemsTable from './LowStockItemsTable';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, Tooltip } from 'recharts';

interface DashboardStats {
  totalRevenue: number;
  totalProducts: number;
  totalSoldItems: number;
  lowStockItems: number;
  outOfStockItems: number;
  expiredItems: number;
}

interface ChartData {
  categoryChart: { name: string; value: number; color: string; }[];
  topProducts: { name: string; sold: number; }[];
  incomeExpenseChart: { month: string; income: number; expense: number; }[];
  paymentMethodChart: { method: string; amount: number; color: string; }[];
}

interface OwnerDashboardProps {
  selectedBranch?: string | null;
}

export default function OwnerDashboard({ selectedBranch }: OwnerDashboardProps) {
  const [stats, setStats] = useState<DashboardStats>({
    totalRevenue: 0,
    totalProducts: 0,
    totalSoldItems: 0,
    lowStockItems: 0,
    outOfStockItems: 0,
    expiredItems: 0
  });
  const [chartData, setChartData] = useState<ChartData>({
    categoryChart: [],
    topProducts: [],
    incomeExpenseChart: [],
    paymentMethodChart: []
  });
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    fetchDashboardStats();
  }, [selectedBranch]);

  const fetchDashboardStats = async () => {
    try {
      // Build query with branch filter if selected
      let salesQuery = supabase.from('sales').select('total_amount, payment_method, created_at');
      let medicinesQuery = supabase.from('medicines').select('stock_quantity, minimum_stock_level, category');
      let saleItemsQuery = supabase.from('sale_items').select('quantity, medicines(name, category)');
      let expiredQuery = supabase.from('medicines').select('id').not('expiry_date', 'is', null).lte('expiry_date', new Date().toISOString().split('T')[0]);
      let expensesQuery = supabase.from('expenses').select('amount, created_at');

      if (selectedBranch) {
        salesQuery = salesQuery.eq('branch_id', selectedBranch);
        medicinesQuery = medicinesQuery.eq('branch_id', selectedBranch);
        expiredQuery = expiredQuery.eq('branch_id', selectedBranch);
        expensesQuery = expensesQuery.eq('branch_id', selectedBranch);
        // For sale_items, we need to join with sales to filter by branch
        saleItemsQuery = supabase
          .from('sale_items')
          .select('quantity, medicines(name, category), sales!inner(branch_id)')
          .eq('sales.branch_id', selectedBranch);
      }

      // Fetch total revenue
      const { data: salesData } = await salesQuery;
      
      const totalRevenue = salesData?.reduce((sum, sale) => sum + Number(sale.total_amount), 0) || 0;

      // Fetch total products
      const { data: medicinesData } = await medicinesQuery;
      
      const totalProducts = medicinesData?.length || 0;
      const lowStockItems = medicinesData?.filter(
        medicine => medicine.stock_quantity <= medicine.minimum_stock_level && medicine.stock_quantity > 0
      ).length || 0;
      const outOfStockItems = medicinesData?.filter(medicine => medicine.stock_quantity === 0).length || 0;

      // Fetch total sold items
      const { data: saleItemsData } = await saleItemsQuery;
      
      const totalSoldItems = saleItemsData?.reduce((sum, item) => sum + item.quantity, 0) || 0;

      // Fetch expired items count
      const { data: expiredMedicinesData } = await expiredQuery;
      
      const expiredItems = expiredMedicinesData?.length || 0;

      // Fetch expenses
      const { data: expensesData } = await expensesQuery;

      setStats({
        totalRevenue,
        totalProducts,
        totalSoldItems,
        lowStockItems,
        outOfStockItems,
        expiredItems
      });

      // Process chart data
      const categoryColors = ['#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#f97316', '#8b5a2b'];
      
      // Category chart (items sold by category)
      const categoryMap = new Map();
      saleItemsData?.forEach(item => {
        const category = item.medicines?.category || 'Other';
        categoryMap.set(category, (categoryMap.get(category) || 0) + item.quantity);
      });
      
      const categoryChart = Array.from(categoryMap.entries()).map(([name, value], index) => ({
        name,
        value,
        color: categoryColors[index % categoryColors.length]
      }));

      // Top products
      const productMap = new Map();
      saleItemsData?.forEach(item => {
        const name = item.medicines?.name || 'Unknown';
        productMap.set(name, (productMap.get(name) || 0) + item.quantity);
      });
      
      const topProducts = Array.from(productMap.entries())
        .map(([name, sold]) => ({ name, sold }))
        .sort((a, b) => b.sold - a.sold)
        .slice(0, 5);

      // Income vs Expense (last 6 months)
      const last6Months = [];
      const today = new Date();
      for (let i = 5; i >= 0; i--) {
        const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
        const monthName = date.toLocaleDateString('en', { month: 'short' });
        
        const monthIncome = salesData?.filter(sale => {
          const saleDate = new Date(sale.created_at);
          return saleDate.getMonth() === date.getMonth() && saleDate.getFullYear() === date.getFullYear();
        }).reduce((sum, sale) => sum + (sale.total_amount ? Number(sale.total_amount) : 0), 0) || 0;

        const monthExpense = expensesData?.filter(expense => {
          const expenseDate = new Date(expense.created_at);
          return expenseDate.getMonth() === date.getMonth() && expenseDate.getFullYear() === date.getFullYear();
        }).reduce((sum, expense) => sum + (expense.amount ? Number(expense.amount) : 0), 0) || 0;

        last6Months.push({ month: monthName, income: monthIncome, expense: monthExpense });
      }

      const paymentMap = new Map();
      salesData?.forEach(sale => {
        const method = sale.payment_method || 'Cash';
        paymentMap.set(method, (paymentMap.get(method) || 0) + (sale.total_amount ? Number(sale.total_amount) : 0));
      });

      const paymentMethodColors = ['#06b6d4', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444'];
      const paymentMethodChart = Array.from(paymentMap.entries()).map(([method, amount], index) => ({
        method,
        amount,
        color: paymentMethodColors[index % paymentMethodColors.length]
      }));

      setChartData({
        categoryChart,
        topProducts,
        incomeExpenseChart: last6Months,
        paymentMethodChart
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to fetch dashboard statistics",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Owner Dashboard</h1>
        <div className="text-sm text-muted-foreground">
          {selectedBranch ? 'Branch-specific data' : 'All branches data'}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">ETB {stats.totalRevenue.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground">
              Total sales revenue
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Products</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalProducts}</div>
            <p className="text-xs text-muted-foreground">
              Products in inventory
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Sold Items</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalSoldItems}</div>
            <p className="text-xs text-muted-foreground">
              Total items sold
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Low Stock Alert</CardTitle>
            <AlertTriangle className="h-4 w-4 text-warning" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-warning">{stats.lowStockItems}</div>
            <p className="text-xs text-muted-foreground">
              Items need restock
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Out of Stock</CardTitle>
            <Package className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{stats.outOfStockItems || 0}</div>
            <p className="text-xs text-muted-foreground">
              Items out of stock
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Expired Medicines</CardTitle>
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{stats.expiredItems}</div>
            <p className="text-xs text-muted-foreground">
              Medicines expired
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Tabs */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="inventory">Inventory</TabsTrigger>
          <TabsTrigger value="sales">Sales</TabsTrigger>
          <TabsTrigger value="finance">Finance</TabsTrigger>
          <TabsTrigger value="suppliers">Suppliers</TabsTrigger>
          <TabsTrigger value="staff">Staff</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            {/* Items Sold per Day by Category */}
            <Card>
              <CardHeader>
                <CardTitle>Items Sold by Category</CardTitle>
                <CardDescription>Distribution of sold items by category</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData.categoryChart}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="value" fill="#8b5cf6" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Income vs Expense Chart */}
            <Card>
              <CardHeader>
                <CardTitle>Income vs Expense (6 Months)</CardTitle>
                <CardDescription>Monthly comparison of income and expenses</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData.incomeExpenseChart}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" />
                      <YAxis />
                      <Tooltip />
                      <Line type="monotone" dataKey="income" stroke="#10b981" strokeWidth={2} />
                      <Line type="monotone" dataKey="expense" stroke="#ef4444" strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Top-Selling Products */}
            <Card>
              <CardHeader>
                <CardTitle>Top-Selling Products</CardTitle>
                <CardDescription>Most popular items by quantity sold</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData.topProducts} layout="horizontal">
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" />
                      <YAxis dataKey="name" type="category" width={100} />
                      <Tooltip />
                      <Bar dataKey="sold" fill="#06b6d4" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Payment Method Pie Chart */}
            <Card>
              <CardHeader>
                <CardTitle>Payment Methods</CardTitle>
                <CardDescription>Revenue distribution by payment method</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={chartData.paymentMethodChart}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ method, percent }) => `${method} ${(Number(percent) * 100).toFixed(0)}%`}
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="amount"
                      >
                        {chartData.paymentMethodChart.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="inventory">
          <InventoryManagement selectedBranch={selectedBranch} />
        </TabsContent>

        <TabsContent value="sales">
          <SalesManagement selectedBranch={selectedBranch} />
        </TabsContent>

        <TabsContent value="finance">
          <FinanceManagement selectedBranch={selectedBranch} />
        </TabsContent>

        <TabsContent value="suppliers">
          <SupplierManagement selectedBranch={selectedBranch} />
        </TabsContent>

        <TabsContent value="staff">
          <StaffManagement selectedBranch={selectedBranch} />
        </TabsContent>
      </Tabs>
    </div>
  );
}