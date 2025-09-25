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
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useBranchContext } from '@/hooks/useBranchContext';
import { useAuth } from '@/hooks/useAuth';
import InventoryManagement from '@/components/inventory/InventoryManagement';
import SalesManagement from '@/components/sales/SalesManagement';
import FinanceManagement from '@/components/finance/FinanceManagement';
import SupplierManagement from '@/components/suppliers/SupplierManagement';
import StaffManagement from '@/components/staff/StaffManagement';
import ExpiredMedicinesTable from './ExpiredMedicinesTable';
import LowStockItemsTable from './LowStockItemsTable';

interface DashboardStats {
  totalRevenue: number;
  totalProducts: number;
  totalSoldItems: number;
  lowStockItems: number;
  outOfStockItems: number;
  expiredItems: number;
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

export default function OwnerDashboard() {
  const [stats, setStats] = useState<DashboardStats>({
    totalRevenue: 0,
    totalProducts: 0,
    totalSoldItems: 0,
    lowStockItems: 0,
    outOfStockItems: 0,
    expiredItems: 0
  });
  const [categorySales, setCategorySales] = useState<CategorySalesData[]>([]);
  const [productPerformance, setProductPerformance] = useState<ProductPerformanceData[]>([]);
  const [paymentMethodData, setPaymentMethodData] = useState<PaymentMethodData[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { selectedBranch } = useBranchContext();
  const { profile } = useAuth();

  useEffect(() => {
    fetchDashboardStats();
  }, [selectedBranch, profile]);

  const fetchDashboardStats = async () => {
    try {
      // Get user's branches first for "All Branches" filtering
      const { data: userBranches } = await supabase
        .from('pharmacy_branches')
        .select('id')
        .eq('pharmacy_owner_id', profile?.id);
      
      const userBranchIds = userBranches?.map(b => b.id) || [];

      // Build queries with branch filtering
      let salesQuery = supabase.from('sales').select('total_amount, payment_method, discount_amount, branch_id');
      let medicinesQuery = supabase.from('medicines').select('stock_quantity, minimum_stock_level, expiry_date, branch_id');
      
      // For sale_items, we need to join with sales to get branch filtering
      let saleItemsQuery = supabase
        .from('sale_items')
        .select(`
          quantity,
          sales!inner(branch_id)
        `);

      if (selectedBranch) {
        // Filter by specific branch
        salesQuery = salesQuery.eq('branch_id', selectedBranch);
        medicinesQuery = medicinesQuery.eq('branch_id', selectedBranch);
        saleItemsQuery = saleItemsQuery.eq('sales.branch_id', selectedBranch);
      } else {
        // Filter by user's branches only (All Branches)
        if (userBranchIds.length > 0) {
          salesQuery = salesQuery.in('branch_id', userBranchIds);
          medicinesQuery = medicinesQuery.in('branch_id', userBranchIds);
          saleItemsQuery = saleItemsQuery.in('sales.branch_id', userBranchIds);
        }
      }

      // Fetch data
      const { data: salesData } = await salesQuery;
      const { data: medicinesData } = await medicinesQuery;
      const { data: saleItemsData } = await saleItemsQuery;
      
      const totalRevenue = salesData?.reduce((sum, sale) => sum + Number(sale.total_amount), 0) || 0;
      const totalProducts = medicinesData?.length || 0;
      const lowStockItems = medicinesData?.filter(
        medicine => medicine.stock_quantity <= medicine.minimum_stock_level && medicine.stock_quantity > 0
      ).length || 0;
      const outOfStockItems = medicinesData?.filter(medicine => medicine.stock_quantity === 0).length || 0;
      const totalSoldItems = saleItemsData?.reduce((sum, item) => sum + item.quantity, 0) || 0;

      // Fetch expired items count with branch filtering
      let expiredQuery = supabase
        .from('medicines')
        .select('id')
        .not('expiry_date', 'is', null)
        .lte('expiry_date', new Date().toISOString().split('T')[0]);
      
      if (selectedBranch) {
        expiredQuery = expiredQuery.eq('branch_id', selectedBranch);
      } else if (userBranchIds.length > 0) {
        expiredQuery = expiredQuery.in('branch_id', userBranchIds);
      }

      const { data: expiredMedicinesData } = await expiredQuery;
      const expiredItems = expiredMedicinesData?.length || 0;

      // Fetch sales data with items for charts
      let salesWithItemsQuery = supabase
        .from('sales')
        .select(`
          *,
          sale_items (
            quantity,
            medicine_id,
            medicines (name, category)
          )
        `);
      
      if (selectedBranch) {
        salesWithItemsQuery = salesWithItemsQuery.eq('branch_id', selectedBranch);
      } else if (userBranchIds.length > 0) {
        salesWithItemsQuery = salesWithItemsQuery.in('branch_id', userBranchIds);
      }

      const { data: salesWithItems } = await salesWithItemsQuery;

      // Process category sales data
      const categoryMap = new Map<string, { sales: number; revenue: number }>();
      salesWithItems?.forEach(sale => {
        sale.sale_items?.forEach((item: any) => {
          if (item.medicines) {
            const category = item.medicines.category;
            const existing = categoryMap.get(category) || { sales: 0, revenue: 0 };
            // Calculate item-specific revenue (assuming equal distribution for simplicity)
            const itemRevenue = (Number(sale.total_amount) * item.quantity) / 
              (sale.sale_items?.reduce((sum: number, si: any) => sum + si.quantity, 0) || 1);
            categoryMap.set(category, {
              sales: existing.sales + item.quantity,
              revenue: existing.revenue + itemRevenue
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
            // Calculate item-specific revenue (assuming equal distribution for simplicity)
            const itemRevenue = (Number(sale.total_amount) * item.quantity) / 
              (sale.sale_items?.reduce((sum: number, si: any) => sum + si.quantity, 0) || 1);
            productMap.set(name, {
              sales: existing.sales + item.quantity,
              revenue: existing.revenue + itemRevenue
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
      salesData?.forEach(sale => {
        const method = sale.payment_method || 'Cash';
        const amount = Number(sale.total_amount) - (Number(sale.discount_amount) || 0);
        paymentMap.set(method, (paymentMap.get(method) || 0) + amount);
      });

      const paymentMethodArray = Array.from(paymentMap.entries()).map(([method, amount]) => ({
        method,
        amount
      }));

      setStats({
        totalRevenue,
        totalProducts,
        totalSoldItems,
        lowStockItems,
        outOfStockItems,
        expiredItems
      });
      setCategorySales(categorySalesArray);
      setProductPerformance(productPerformanceArray);
      setPaymentMethodData(paymentMethodArray);
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
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Items Sold per Day (by category) */}
            <Card>
              <CardHeader>
                <CardTitle>Items Sold by Category</CardTitle>
                <CardDescription>Sales performance by medicine category</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={categorySales}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="category" />
                    <YAxis />
                    <Bar dataKey="sales" fill="hsl(var(--primary))" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Top-Selling Products */}
            <Card>
              <CardHeader>
                <CardTitle>Top-Selling Products</CardTitle>
                <CardDescription>Best performing medicines</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={productPerformance.slice(0, 5)}
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      fill="hsl(var(--secondary))"
                      dataKey="sales"
                      label={(entry: any) => entry.name}
                    >
                      {productPerformance.slice(0, 5).map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={`hsl(${(index * 72) % 360}, 70%, 50%)`} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Payment Method Distribution */}
            <Card>
              <CardHeader>
                <CardTitle>Payment Methods</CardTitle>
                <CardDescription>Revenue by payment method</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={paymentMethodData}
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      fill="hsl(var(--accent))"
                      dataKey="amount"
                      label={(entry: any) => `${entry.method}: ETB ${Number(entry.amount).toFixed(2)}`}
                    >
                      {paymentMethodData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={`hsl(${(index * 90) % 360}, 65%, 55%)`} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Quick Actions</CardTitle>
                <CardDescription>Frequently used actions</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <Button variant="outline" className="h-20 flex flex-col">
                    <Plus className="h-6 w-6 mb-2" />
                    Add Medicine
                  </Button>
                  <Button variant="outline" className="h-20 flex flex-col">
                    <ShoppingCart className="h-6 w-6 mb-2" />
                    New Sale
                  </Button>
                  <Button variant="outline" className="h-20 flex flex-col">
                    <Users className="h-6 w-6 mb-2" />
                    Manage Staff
                  </Button>
                  <Button variant="outline" className="h-20 flex flex-col">
                    <FileText className="h-6 w-6 mb-2" />
                    Reports
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="inventory">
          <InventoryManagement />
        </TabsContent>

        <TabsContent value="sales">
          <SalesManagement />
        </TabsContent>

        <TabsContent value="finance">
          <FinanceManagement />
        </TabsContent>

        <TabsContent value="suppliers">
          <SupplierManagement />
        </TabsContent>

        <TabsContent value="staff">
          <StaffManagement />
        </TabsContent>
      </Tabs>
    </div>
  );
}