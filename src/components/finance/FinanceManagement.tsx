import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import { DollarSign, TrendingUp, TrendingDown, BarChart3, Plus, CalendarIcon } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useBranchContext } from '@/hooks/useBranchContext';
import MedicineTransfer from '@/components/inventory/MedicineTransfer';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface FinanceStats {
  totalIncome: number;
  totalExpenses: number;
  netProfit: number;
  profitMargin: number;
}

interface Expense {
  id: string;
  description: string;
  amount: number;
  category: string;
  created_at: string;
}

interface Sale {
  id: string;
  total_amount: number;
  discount_amount?: number;
  created_at: string;
  sold_by?: string;
  seller?: {
    full_name: string;
    role: string;
  };
  sale_items?: {
    medicines: {
      name: string;
    };
    quantity: number;
    sale_type?: string;
    stripes_sold?: number;
  }[];
}

interface BranchData {
  branchId: string;
  branchName: string;
  income: number;
  expenses: number;
}

export default function FinanceManagement() {
  const [stats, setStats] = useState<FinanceStats>({
    totalIncome: 0,
    totalExpenses: 0,
    netProfit: 0,
    profitMargin: 0
  });
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [paginatedSales, setPaginatedSales] = useState<Sale[]>([]);
  const [paginatedExpenses, setPaginatedExpenses] = useState<Expense[]>([]);
  const [salesPage, setSalesPage] = useState(1);
  const [expensesPage, setExpensesPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [period, setPeriod] = useState('monthly');
  const [startDate, setStartDate] = useState<Date>();
  const [endDate, setEndDate] = useState<Date>();
  const [branchData, setBranchData] = useState<BranchData[]>([]);
  const { profile } = useAuth();
  const { toast } = useToast();
  const { selectedBranch } = useBranchContext();
  
  const itemsPerPage = 15;

  useEffect(() => {
    fetchFinanceData();

    // Set up real-time subscription for expenses
    const expenseSubscription = supabase
      .channel('expense-changes')
      .on('postgres_changes', 
        { event: '*', schema: 'public', table: 'expenses' },
        () => {
          fetchFinanceData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(expenseSubscription);
    };
  }, [period, startDate, endDate, selectedBranch]);

  const fetchFinanceData = async () => {
    try {
      const now = new Date();
      let queryStartDate = startDate || new Date();
      let queryEndDate = endDate || now;

      if (!startDate && !endDate) {
        switch (period) {
          case 'daily':
            queryStartDate.setDate(now.getDate() - 1);
            break;
          case 'weekly':
            queryStartDate.setDate(now.getDate() - 7);
            break;
          case 'monthly':
            queryStartDate.setMonth(now.getMonth() - 1);
            break;
          case 'yearly':
            queryStartDate.setFullYear(now.getFullYear() - 1);
            break;
        }
      }

      // Fetch sales with medicine details - RLS handles ownership filtering
      let salesQuery = supabase
        .from('sales')
        .select(`
          *,
          sale_items (
            quantity,
            sale_type,
            stripes_sold,
            medicines (
              name
            )
          )
        `)
        .gte('created_at', queryStartDate.toISOString())
        .lte('created_at', queryEndDate.toISOString())
        .order('created_at', { ascending: false });

      // Filter by specific branch if selected
      if (selectedBranch) {
        salesQuery = salesQuery.eq('branch_id', selectedBranch);
      }

      const { data: salesData, error: salesError } = await salesQuery;

      if (salesError) throw salesError;
      
      // Batch-fetch seller information to avoid N+1 and 400s
      const sellerIds = Array.from(new Set((salesData || [])
        .map((s: any) => s.sold_by)
        .filter((id: string | null) => !!id)));

      let sellersMap = new Map<string, { full_name: string; email: string; role: string }>();
      if (sellerIds.length === 1) {
        const { data: oneSeller, error: oneSellerError } = await supabase
          .from('profiles')
          .select('id,full_name,role')
          .eq('id', sellerIds[0])
          .maybeSingle();
        if (!oneSellerError && oneSeller) {
          sellersMap.set(oneSeller.id, oneSeller as any);
        }
      } else if (sellerIds.length > 1) {
        const { data: sellersData, error: sellersError } = await supabase
          .from('profiles')
          .select('id,full_name,role')
          .in('id', sellerIds);
        if (!sellersError && sellersData) {
          sellersData.forEach((u: any) => sellersMap.set(u.id, u));
        }
      }

      const salesWithSeller = (salesData || []).map((sale: any) => ({
        ...sale,
        seller: sale.sold_by ? sellersMap.get(sale.sold_by) || null : null,
      }));

      // Fetch expenses - RLS handles ownership filtering
      let expensesQuery = supabase
        .from('expenses')
        .select('*')
        .gte('created_at', queryStartDate.toISOString())
        .lte('created_at', queryEndDate.toISOString())
        .order('created_at', { ascending: false });

      // Filter by specific branch if selected
      if (selectedBranch) {
        expensesQuery = expensesQuery.eq('branch_id', selectedBranch);
      }

      const { data: expensesData, error: expensesError } = await expensesQuery;

      if (expensesError) throw expensesError;

      setSales(salesWithSeller || []);
      setExpenses(expensesData || []);

      // Calculate stats
      const totalIncome = salesData?.reduce((sum, sale) => sum + Number(sale.total_amount), 0) || 0;
      const totalExpenses = expensesData?.reduce((sum, expense) => sum + Number(expense.amount), 0) || 0;
      const netProfit = totalIncome - totalExpenses;
      const profitMargin = totalIncome > 0 ? (netProfit / totalIncome) * 100 : 0;

      setStats({
        totalIncome,
        totalExpenses,
        netProfit,
        profitMargin
      });

      // Calculate branch-wise data for the chart
      if (profile?.role === 'owner' && !selectedBranch) {
        // Fetch all branches for the owner
        const { data: branchesData } = await supabase
          .from('pharmacy_branches')
          .select('id, name')
          .eq('pharmacy_owner_id', profile.id);

        const branchStats: BranchData[] = (branchesData || []).map(branch => {
          const branchSales = salesData?.filter((s: any) => s.branch_id === branch.id) || [];
          const branchExpenses = expensesData?.filter((e: any) => e.branch_id === branch.id) || [];
          
          return {
            branchId: branch.id,
            branchName: branch.name,
            income: branchSales.reduce((sum, sale) => sum + Number(sale.total_amount), 0),
            expenses: branchExpenses.reduce((sum, expense) => sum + Number(expense.amount), 0)
          };
        });

        setBranchData(branchStats);
      } else {
        setBranchData([]);
      }
      
      // Reset pagination when data changes
      setSalesPage(1);
      setExpensesPage(1);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to fetch finance data",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const startIndex = (salesPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    setPaginatedSales(sales.slice(startIndex, endIndex));
  }, [sales, salesPage]);

  useEffect(() => {
    const startIndex = (expensesPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    setPaginatedExpenses(expenses.slice(startIndex, endIndex));
  }, [expenses, expensesPage]);

  const handleAddExpense = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    
    const formData = new FormData(e.currentTarget);
    const expenseData = {
      description: formData.get('description') as string,
      amount: parseFloat(formData.get('amount') as string),
      category: formData.get('category') as string,
      created_by: profile?.id,
      branch_id: selectedBranch || profile?.branch_id
    };

    try {
      const { error } = await supabase
        .from('expenses')
        .insert([expenseData]);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Expense added successfully"
      });

      setShowAddExpense(false);
      fetchFinanceData();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to add expense",
        variant: "destructive"
      });
    }
  };

  if (loading) {
    return <div>Loading finance data...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Finance Management</h2>
        <div className="flex items-center space-x-4">
          <Select value={period} onValueChange={setPeriod}>
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
                {startDate ? format(startDate, "PPP") : <span>Start date</span>}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0">
              <Calendar
                mode="single"
                selected={startDate}
                onSelect={setStartDate}
                initialFocus
                className="p-3 pointer-events-auto"
              />
            </PopoverContent>
          </Popover>
          
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-48 justify-start text-left font-normal">
                <CalendarIcon className="mr-2 h-4 w-4" />
                {endDate ? format(endDate, "PPP") : <span>End date</span>}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0">
              <Calendar
                mode="single"
                selected={endDate}
                onSelect={setEndDate}
                initialFocus
                className="p-3 pointer-events-auto"
              />
            </PopoverContent>
          </Popover>
          
          <Dialog open={showAddExpense} onOpenChange={setShowAddExpense}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Add Expense
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add New Expense</DialogTitle>
                <DialogDescription>
                  Record a new business expense
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleAddExpense} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Input id="description" name="description" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="amount">Amount</Label>
                  <Input
                    id="amount"
                    name="amount"
                    type="number"
                    step="0.01"
                    min="0"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="category">Category</Label>
                  <Input
                    id="category"
                    name="category"
                    placeholder="e.g., Utilities, Supplies, Rent"
                    required
                  />
                </div>
                <div className="flex justify-end space-x-2">
                  <Button type="button" variant="outline" onClick={() => setShowAddExpense(false)}>
                    Cancel
                  </Button>
                  <Button type="submit">Add Expense</Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Income</CardTitle>
            <DollarSign className="h-4 w-4 text-success" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-success">ETB {stats.totalIncome.toFixed(2)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Expenses</CardTitle>
            <TrendingDown className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">ETB {stats.totalExpenses.toFixed(2)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Net Profit</CardTitle>
            <TrendingUp className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${stats.netProfit >= 0 ? 'text-success' : 'text-destructive'}`}>
              ETB {stats.netProfit.toFixed(2)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Profit Margin</CardTitle>
            <BarChart3 className="h-4 w-4 text-info" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${stats.profitMargin >= 0 ? 'text-success' : 'text-destructive'}`}>
              {stats.profitMargin.toFixed(1)}%
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Views */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="income">Income</TabsTrigger>
          <TabsTrigger value="expenses">Expenses</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
          <TabsTrigger value="transfer">Transfer Medicine</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="space-y-6">
            {branchData.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Income vs Expenses by Branch</CardTitle>
                  <CardDescription>Comparison across all branches</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={350}>
                    <BarChart data={branchData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="branchName" />
                      <YAxis />
                      <Tooltip 
                        formatter={(value: number) => `ETB ${value.toFixed(2)}`}
                      />
                      <Legend />
                      <Bar dataKey="income" fill="hsl(var(--success))" name="Income" />
                      <Bar dataKey="expenses" fill="hsl(var(--destructive))" name="Expenses" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Income vs Expenses Summary</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <span>Income</span>
                      <span className="text-success font-medium">ETB {stats.totalIncome.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span>Expenses</span>
                      <span className="text-destructive font-medium">ETB {stats.totalExpenses.toFixed(2)}</span>
                    </div>
                    <div className="border-t pt-2">
                      <div className="flex justify-between items-center font-bold">
                        <span>Net Result</span>
                        <span className={stats.netProfit >= 0 ? 'text-success' : 'text-destructive'}>
                          ETB {stats.netProfit.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="income">
          <Card>
            <CardHeader>
              <CardTitle>Income Details</CardTitle>
              <CardDescription>Recent sales transactions</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {paginatedSales.map((sale) => (
                  <div key={sale.id} className="flex justify-between items-start p-2 border rounded">
                    <div className="flex-1">
                      <div className="font-medium">
                        {sale.sale_items && sale.sale_items.length > 0
                          ? sale.sale_items.map((item, index) => (
                              <span key={index}>
                                {item.medicines?.name} (x{item.quantity})
                                {item.sale_type === 'by_stripe' && item.stripes_sold && (
                                  <span className="text-xs text-muted-foreground ml-1">
                                    [{item.stripes_sold} stripes]
                                  </span>
                                )}
                                {index < sale.sale_items!.length - 1 ? ', ' : ''}
                              </span>
                            ))
                          : `Sale #${sale.id.slice(-8)}`
                        }
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(sale.created_at).toLocaleDateString()}
                      </div>
                      {sale.discount_amount && sale.discount_amount > 0 && (
                        <div className="text-xs text-muted-foreground mt-1">
                          Discount: ETB {Number(sale.discount_amount).toFixed(2)}
                        </div>
                      )}
                      {/* Display stripes sold summary */}
                      {sale.sale_items && sale.sale_items.some(item => item.sale_type === 'by_stripe') && (
                        <div className="text-xs text-info mt-1">
                          Stripes Sold: {sale.sale_items
                            .filter(item => item.sale_type === 'by_stripe')
                            .reduce((sum, item) => sum + (item.stripes_sold || 0), 0)}
                        </div>
                      )}
                       <div className="text-xs mt-1 flex gap-2">
                          <span className="text-muted-foreground">
                            Sold by:
                          </span>
                          {sale.seller ? (
                            <span className="font-medium text-foreground">
                              {sale.seller.role === 'owner' ? 'Owner' : 'Staff'} ({sale.seller.full_name || 'N/A'})
                            </span>
                          ) : (
                            <span className="font-medium text-foreground">
                              N/A
                            </span>
                          )}
                        </div>
                    </div>
                    <div className="text-success font-medium">ETB {Number(sale.total_amount).toFixed(2)}</div>
                  </div>
                ))}
                {sales.length === 0 && (
                  <p className="text-muted-foreground text-center py-4">No sales in selected period</p>
                )}
                
                {/* Pagination for Sales */}
                {Math.ceil(sales.length / itemsPerPage) > 1 && (
                  <div className="flex justify-center pt-4">
                    <Pagination>
                      <PaginationContent>
                        <PaginationItem>
                          <PaginationPrevious 
                            href="#"
                            onClick={(e) => {
                              e.preventDefault();
                              if (salesPage > 1) setSalesPage(salesPage - 1);
                            }}
                            className={salesPage === 1 ? "pointer-events-none opacity-50" : ""}
                          />
                        </PaginationItem>
                        
                        {Array.from({ length: Math.ceil(sales.length / itemsPerPage) }, (_, i) => i + 1).map((page) => (
                          <PaginationItem key={page}>
                            <PaginationLink
                              href="#"
                              onClick={(e) => {
                                e.preventDefault();
                                setSalesPage(page);
                              }}
                              isActive={salesPage === page}
                            >
                              {page}
                            </PaginationLink>
                          </PaginationItem>
                        ))}
                        
                        <PaginationItem>
                          <PaginationNext 
                            href="#"
                            onClick={(e) => {
                              e.preventDefault();
                              if (salesPage < Math.ceil(sales.length / itemsPerPage)) setSalesPage(salesPage + 1);
                            }}
                            className={salesPage === Math.ceil(sales.length / itemsPerPage) ? "pointer-events-none opacity-50" : ""}
                          />
                        </PaginationItem>
                      </PaginationContent>
                    </Pagination>
                  </div>
                )}
                
                <div className="text-center text-sm text-muted-foreground">
                  Showing {paginatedSales.length} of {sales.length} sales records
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="expenses">
          <Card>
            <CardHeader>
              <CardTitle>Expense Details</CardTitle>
              <CardDescription>Business expenses breakdown</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {paginatedExpenses.map((expense) => (
                  <div key={expense.id} className="flex justify-between items-center p-2 border rounded">
                    <div>
                      <div className="font-medium">{expense.description}</div>
                      <div className="text-xs text-muted-foreground">{expense.category}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-destructive font-medium">-ETB {expense.amount}</div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(expense.created_at).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                ))}
                {expenses.length === 0 && (
                  <p className="text-muted-foreground text-center py-4">No expenses in selected period</p>
                )}
                
                {/* Pagination for Expenses */}
                {Math.ceil(expenses.length / itemsPerPage) > 1 && (
                  <div className="flex justify-center pt-4">
                    <Pagination>
                      <PaginationContent>
                        <PaginationItem>
                          <PaginationPrevious 
                            href="#"
                            onClick={(e) => {
                              e.preventDefault();
                              if (expensesPage > 1) setExpensesPage(expensesPage - 1);
                            }}
                            className={expensesPage === 1 ? "pointer-events-none opacity-50" : ""}
                          />
                        </PaginationItem>
                        
                        {Array.from({ length: Math.ceil(expenses.length / itemsPerPage) }, (_, i) => i + 1).map((page) => (
                          <PaginationItem key={page}>
                            <PaginationLink
                              href="#"
                              onClick={(e) => {
                                e.preventDefault();
                                setExpensesPage(page);
                              }}
                              isActive={expensesPage === page}
                            >
                              {page}
                            </PaginationLink>
                          </PaginationItem>
                        ))}
                        
                        <PaginationItem>
                          <PaginationNext 
                            href="#"
                            onClick={(e) => {
                              e.preventDefault();
                              if (expensesPage < Math.ceil(expenses.length / itemsPerPage)) setExpensesPage(expensesPage + 1);
                            }}
                            className={expensesPage === Math.ceil(expenses.length / itemsPerPage) ? "pointer-events-none opacity-50" : ""}
                          />
                        </PaginationItem>
                      </PaginationContent>
                    </Pagination>
                  </div>
                )}
                
                <div className="text-center text-sm text-muted-foreground">
                  Showing {paginatedExpenses.length} of {expenses.length} expense records
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reports">
          <Card>
            <CardHeader>
              <CardTitle>Financial Report</CardTitle>
              <CardDescription>Summary of financial performance</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <h4 className="font-medium">Performance Metrics</h4>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span>Total Transactions:</span>
                        <span>{sales.length}</span>
                      </div>
                      <div className="flex justify-between">
                       <span>Average Income:</span>
                        <span>ETB {sales.length > 0 ? (stats.totalIncome / sales.length).toFixed(2) : '0.00'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Average Expense:</span>
                        <span>ETB {expenses.length > 0 ? (stats.totalExpenses / expenses.length).toFixed(2) : '0.00'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Total Expenses:</span>
                        <span>{expenses.length}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="transfer">
          <MedicineTransfer />
        </TabsContent>
      </Tabs>
    </div>
  );
}