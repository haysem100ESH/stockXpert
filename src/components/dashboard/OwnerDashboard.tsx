import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DollarSign, 
  Package, 
  TrendingUp, 
  AlertTriangle,
  Plus,
  Users,
  FileText,
  ShoppingCart,
  MessageCircle,
  ExternalLink,
  Send
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { supabase } from '@/lib/db';
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

import SubscriptionPlanCard from '@/components/subscription/SubscriptionPlanCard';
import { TelegramConnectionDialog } from '@/components/telegram/TelegramConnectionDialog';

interface DashboardStats {
  totalRevenue: number;
  totalProducts: number;
  totalMedicines: number;
  totalItems: number;
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
    totalMedicines: 0,
    totalItems: 0,
    totalSoldItems: 0,
    lowStockItems: 0,
    outOfStockItems: 0,
    expiredItems: 0
  });
  const [categorySales, setCategorySales] = useState<CategorySalesData[]>([]);
  const [medicinesCategorySales, setMedicinesCategorySales] = useState<CategorySalesData[]>([]);
  const [itemsCategorySales, setItemsCategorySales] = useState<CategorySalesData[]>([]);
  const [productPerformance, setProductPerformance] = useState<ProductPerformanceData[]>([]);
  const [topMedicines, setTopMedicines] = useState<ProductPerformanceData[]>([]);
  const [topItems, setTopItems] = useState<ProductPerformanceData[]>([]);
  const [paymentMethodData, setPaymentMethodData] = useState<PaymentMethodData[]>([]);
  const [loading, setLoading] = useState(true);
  const [sendingTestMessage, setSendingTestMessage] = useState(false);
  const [dateFilter, setDateFilter] = useState('monthly');
  const { toast } = useToast();
  const { selectedBranch, branchType } = useBranchContext();
  const { profile } = useAuth();
  const isPharmacy = branchType === 'pharmacy';

  useEffect(() => {
    fetchDashboardStats();
  }, [selectedBranch, profile, dateFilter]);

  const fetchDashboardStats = async () => {
    try {
      // Get date range based on filter
      const now = new Date();
      let startDate = new Date();
      if (dateFilter === 'daily') {
        startDate.setHours(0, 0, 0, 0);
      } else if (dateFilter === 'weekly') {
        startDate.setDate(now.getDate() - 7);
      } else if (dateFilter === 'monthly') {
        startDate.setMonth(now.getMonth() - 1);
      } else if (dateFilter === 'yearly') {
        startDate.setFullYear(now.getFullYear() - 1);
      }

      const medicineCategories = ['tablet', 'capsule', 'syrup', 'injection', 'cream', 'ointment', 'drops', 'inhaler'];
      
      // Build queries - RLS policies handle ownership filtering automatically
      let salesQuery = supabase.from('sales').select('total_amount, payment_method, discount_amount, branch_id, created_at')
        .gte('created_at', startDate.toISOString())
        .lte('created_at', now.toISOString());
      let medicinesQuery = supabase.from('medicines').select('stock_quantity, minimum_stock_level, expiry_date, branch_id, category');
      let saleItemsQuery = supabase
        .from('sale_items')
        .select(`
          quantity,
          sales!inner(branch_id, created_at)
        `);

      // Filter by specific branch if selected
      if (selectedBranch) {
        salesQuery = salesQuery.eq('branch_id', selectedBranch);
        medicinesQuery = medicinesQuery.eq('branch_id', selectedBranch);
        saleItemsQuery = saleItemsQuery.eq('sales.branch_id', selectedBranch);
      }

      // Fetch data
      const { data: salesData } = await salesQuery;
      const { data: medicinesData } = await medicinesQuery;
      const { data: saleItemsData } = await saleItemsQuery;
      
      const totalRevenue = salesData?.reduce((sum, sale) => sum + Number(sale.total_amount), 0) || 0;
      const totalProducts = medicinesData?.length || 0;
      const totalMedicines = medicinesData?.filter(m => medicineCategories.includes(m.category)).length || 0;
      const totalItems = medicinesData?.filter(m => !medicineCategories.includes(m.category)).length || 0;
      const lowStockItems = medicinesData?.filter(
        medicine => medicine.stock_quantity <= medicine.minimum_stock_level && medicine.stock_quantity > 0
      ).length || 0;
      const outOfStockItems = medicinesData?.filter(medicine => medicine.stock_quantity === 0).length || 0;
      const totalSoldItems = saleItemsData?.reduce((sum, item) => sum + item.quantity, 0) || 0;

      // Fetch expired items count
      let expiredQuery = supabase
        .from('medicines')
        .select('id')
        .not('expiry_date', 'is', null)
        .lte('expiry_date', new Date().toISOString().split('T')[0]);
      
      if (selectedBranch) {
        expiredQuery = expiredQuery.eq('branch_id', selectedBranch);
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
        `)
        .gte('created_at', startDate.toISOString())
        .lte('created_at', now.toISOString());
      
      if (selectedBranch) {
        salesWithItemsQuery = salesWithItemsQuery.eq('branch_id', selectedBranch);
      }

      const { data: salesWithItems } = await salesWithItemsQuery;

      // Process category sales data (all)
      const categoryMap = new Map<string, { sales: number; revenue: number }>();
      const medicineCategoryMap = new Map<string, { sales: number; revenue: number }>();
      const itemCategoryMap = new Map<string, { sales: number; revenue: number }>();
      
      salesWithItems?.forEach(sale => {
        sale.sale_items?.forEach((item: any) => {
          if (item.medicines) {
            const category = item.medicines.category;
            const isMedicine = medicineCategories.includes(category);
            const existing = categoryMap.get(category) || { sales: 0, revenue: 0 };
            const itemRevenue = (Number(sale.total_amount) * item.quantity) / 
              (sale.sale_items?.reduce((sum: number, si: any) => sum + si.quantity, 0) || 1);
            
            categoryMap.set(category, {
              sales: existing.sales + item.quantity,
              revenue: existing.revenue + itemRevenue
            });

            // Separate into medicine and item categories
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

      const categorySalesArray = Array.from(categoryMap.entries()).map(([category, data]) => ({
        category,
        ...data
      }));

      const medicinesCategorySalesArray = Array.from(medicineCategoryMap.entries()).map(([category, data]) => ({
        category,
        ...data
      }));

      const itemsCategorySalesArray = Array.from(itemCategoryMap.entries()).map(([category, data]) => ({
        category,
        ...data
      }));

      // Process product performance data
      const productMap = new Map<string, { sales: number; revenue: number; category: string }>();
      salesWithItems?.forEach(sale => {
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

      const productPerformanceArray = Array.from(productMap.entries())
        .map(([name, data]) => ({ name, ...data }))
        .sort((a, b) => b.sales - a.sales)
        .slice(0, 10);

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
        totalMedicines,
        totalItems,
        totalSoldItems,
        lowStockItems,
        outOfStockItems,
        expiredItems
      });
      setCategorySales(categorySalesArray);
      setMedicinesCategorySales(medicinesCategorySalesArray);
      setItemsCategorySales(itemsCategorySalesArray);
      setProductPerformance(productPerformanceArray);
      setTopMedicines(topMedicinesArray);
      setTopItems(topItemsArray);
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

  const handleConnectTelegram = () => {
    window.open('https://t.me/pharmaXpertbot', '_blank');
    toast({
      title: "Connect to Telegram Bot",
      description: "Please open the bot in your Telegram app and click Start to complete your connection.",
      duration: 6000,
    });
  };

  const handleTestMessage = async () => {
    setSendingTestMessage(true);
    try {
      const { data, error } = await supabase.functions.invoke('telegram-test-message', {
        body: { userId: profile?.id }
      });

      if (error) throw error;

      toast({
        title: "Test Message Sent! 🎉",
        description: "Check your Telegram for the confirmation message.",
      });
    } catch (error) {
      console.error('Error sending test message:', error);
      toast({
        title: "Error",
        description: "Failed to send test message. Please try again.",
        variant: "destructive"
      });
    } finally {
      setSendingTestMessage(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">Owner Dashboard</h1>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-6">
          {[...Array(6)].map((_, i) => (
            <Card key={i}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-4 rounded" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-20 mb-2" />
                <Skeleton className="h-3 w-32" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 min-w-0">
      <TelegramConnectionDialog />
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-2xl md:text-3xl font-bold">{isPharmacy ? 'Pharmacy Dashboard' : 'Inventory Dashboard'}</h1>
        
        <div className="flex items-center gap-4">
          <Select value={dateFilter} onValueChange={setDateFilter}>
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
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-6">
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

        {isPharmacy && (
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
        )}

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{isPharmacy ? 'Total Items' : 'Total Products'}</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{isPharmacy ? stats.totalItems : stats.totalProducts}</div>
            <p className="text-xs text-muted-foreground">{isPharmacy ? 'Non-medicine items' : 'Products in stock'}</p>
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
            <CardTitle className="text-sm font-medium">{isPharmacy ? 'Expired Medicines' : 'Expired Items'}</CardTitle>
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{stats.expiredItems}</div>
            <p className="text-xs text-muted-foreground">{isPharmacy ? 'Medicines expired' : 'Items expired'}</p>
          </CardContent>
        </Card>
      </div>

      {/* Main Tabs */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="flex flex-wrap w-full h-auto gap-1">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="inventory">Inventory</TabsTrigger>
          <TabsTrigger value="sales">Sales</TabsTrigger>
          <TabsTrigger value="finance">Finance</TabsTrigger>
          <TabsTrigger value="suppliers">Suppliers</TabsTrigger>
          <TabsTrigger value="staff">Staff</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Medicines Sold by Category - pharmacy only */}
            {isPharmacy && (
              <Card className="min-w-0">
                <CardHeader>
                  <CardTitle>Medicines Sold by Category</CardTitle>
                  <CardDescription>Medicine sales performance</CardDescription>
                </CardHeader>
                <CardContent className="p-3 sm:p-6 pt-0 sm:pt-0">
                  <div className="w-full overflow-x-auto">
                    <div style={{ minWidth: 280 }}>
                      <ResponsiveContainer width="100%" height={260}>
                        <BarChart data={medicinesCategorySales} margin={{ left: -20, right: 8, top: 5, bottom: 40 }}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="category" tick={{ fontSize: 10 }} interval={0} angle={-30} textAnchor="end" height={60} />
                          <YAxis tick={{ fontSize: 11 }} width={40} />
                          <Bar dataKey="sales" fill="hsl(var(--primary))" radius={[3,3,0,0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Items Sold by Category */}
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Items Sold by Category</CardTitle>
                <CardDescription>{isPharmacy ? 'Non-medicine items sales' : 'Sales breakdown by category'}</CardDescription>
              </CardHeader>
              <CardContent className="p-3 sm:p-6 pt-0 sm:pt-0">
                <div className="w-full overflow-x-auto">
                  <div style={{ minWidth: 280 }}>
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={isPharmacy ? itemsCategorySales : categorySales} margin={{ left: -20, right: 8, top: 5, bottom: 40 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="category" tick={{ fontSize: 10 }} interval={0} angle={-30} textAnchor="end" height={60} />
                        <YAxis tick={{ fontSize: 11 }} width={40} />
                        <Bar dataKey="sales" fill="hsl(var(--secondary))" radius={[3,3,0,0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Top-Selling Medicines - pharmacy only */}
            {isPharmacy && (
              <Card className="min-w-0">
                <CardHeader>
                  <CardTitle>Top-Selling Medicines</CardTitle>
                  <CardDescription>Best performing medicines</CardDescription>
                </CardHeader>
                <CardContent className="p-3 sm:p-6 pt-0 sm:pt-0">
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie data={topMedicines.slice(0, 5)} cx="50%" cy="50%" outerRadius="55%" fill="hsl(var(--primary))" dataKey="sales" label={false} nameKey="name">
                        {topMedicines.slice(0, 5).map((_, index) => (
                          <Cell key={`cell-${index}`} fill={`hsl(${(index * 72) % 360}, 70%, 50%)`} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="mt-2 flex flex-wrap gap-2 justify-center">
                    {topMedicines.slice(0, 5).map((entry, index) => (
                      <div key={entry.name} className="flex items-center gap-1 text-xs">
                        <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: `hsl(${(index * 72) % 360}, 70%, 50%)` }} />
                        <span className="truncate max-w-[120px]">{entry.name} ({entry.sales})</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Top-Selling Items */}
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Top-Selling Items</CardTitle>
                <CardDescription>{isPharmacy ? 'Best performing items' : 'Best performing products'}</CardDescription>
              </CardHeader>
              <CardContent className="p-3 sm:p-6 pt-0 sm:pt-0">
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={(isPharmacy ? topItems : productPerformance).slice(0, 5)} cx="50%" cy="50%" outerRadius="55%" fill="hsl(var(--accent))" dataKey="sales" label={false} nameKey="name">
                      {(isPharmacy ? topItems : productPerformance).slice(0, 5).map((_, index) => (
                        <Cell key={`cell-${index}`} fill={`hsl(${(index * 90) % 360}, 65%, 55%)`} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="mt-2 flex flex-wrap gap-2 justify-center">
                  {(isPharmacy ? topItems : productPerformance).slice(0, 5).map((entry, index) => (
                    <div key={entry.name} className="flex items-center gap-1 text-xs">
                      <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: `hsl(${(index * 90) % 360}, 65%, 55%)` }} />
                      <span className="truncate max-w-[120px]">{entry.name} ({entry.sales})</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Payment Methods */}
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Payment Methods</CardTitle>
                <CardDescription>Revenue by payment method</CardDescription>
              </CardHeader>
              <CardContent className="p-3 sm:p-6 pt-0 sm:pt-0">
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={paymentMethodData} cx="50%" cy="50%" outerRadius="55%" fill="hsl(var(--accent))" dataKey="amount" label={false} nameKey="method">
                      {paymentMethodData.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={`hsl(${(index * 90) % 360}, 65%, 55%)`} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="mt-2 flex flex-wrap gap-2 justify-center">
                  {paymentMethodData.map((entry, index) => (
                    <div key={entry.method} className="flex items-center gap-1 text-xs">
                      <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: `hsl(${(index * 90) % 360}, 65%, 55%)` }} />
                      <span>{entry.method}: ETB {Number(entry.amount).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Quick Actions</CardTitle>
                <CardDescription>Frequently used actions</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3">
                  <Button variant="outline" className="h-20 flex flex-col gap-1 text-xs sm:text-sm">
                    <Plus className="h-5 w-5" />
                    {isPharmacy ? 'Add Medicine' : 'Add Item'}
                  </Button>
                  <Button variant="outline" className="h-20 flex flex-col gap-1 text-xs sm:text-sm">
                    <ShoppingCart className="h-5 w-5" />
                    New Sale
                  </Button>
                  <Button variant="outline" className="h-20 flex flex-col gap-1 text-xs sm:text-sm">
                    <Users className="h-5 w-5" />
                    Manage Staff
                  </Button>
                  <Button variant="outline" className="h-20 flex flex-col gap-1 text-xs sm:text-sm">
                    <FileText className="h-5 w-5" />
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