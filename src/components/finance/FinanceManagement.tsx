import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { DollarSign, TrendingUp, TrendingDown, BarChart3, Plus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';

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
  created_at: string;
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
  const [loading, setLoading] = useState(true);
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [period, setPeriod] = useState('monthly');
  const { profile } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    fetchFinanceData();
  }, [period]);

  const fetchFinanceData = async () => {
    try {
      const now = new Date();
      let startDate = new Date();

      switch (period) {
        case 'daily':
          startDate.setDate(now.getDate() - 1);
          break;
        case 'weekly':
          startDate.setDate(now.getDate() - 7);
          break;
        case 'monthly':
          startDate.setMonth(now.getMonth() - 1);
          break;
        case 'yearly':
          startDate.setFullYear(now.getFullYear() - 1);
          break;
      }

      // Fetch sales
      const { data: salesData, error: salesError } = await supabase
        .from('sales')
        .select('*')
        .gte('created_at', startDate.toISOString())
        .order('created_at', { ascending: false });

      if (salesError) throw salesError;

      // Fetch expenses
      const { data: expensesData, error: expensesError } = await supabase
        .from('expenses')
        .select('*')
        .gte('created_at', startDate.toISOString())
        .order('created_at', { ascending: false });

      if (expensesError) throw expensesError;

      setSales(salesData || []);
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

  const handleAddExpense = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    
    const formData = new FormData(e.currentTarget);
    const expenseData = {
      description: formData.get('description') as string,
      amount: parseFloat(formData.get('amount') as string),
      category: formData.get('category') as string,
      created_by: profile?.id
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
            <div className="text-2xl font-bold text-success">${stats.totalIncome.toFixed(2)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Expenses</CardTitle>
            <TrendingDown className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">${stats.totalExpenses.toFixed(2)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Net Profit</CardTitle>
            <TrendingUp className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${stats.netProfit >= 0 ? 'text-success' : 'text-destructive'}`}>
              ${stats.netProfit.toFixed(2)}
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
        </TabsList>

        <TabsContent value="overview">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Income vs Expenses</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span>Income</span>
                    <span className="text-success font-medium">${stats.totalIncome.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>Expenses</span>
                    <span className="text-destructive font-medium">${stats.totalExpenses.toFixed(2)}</span>
                  </div>
                  <div className="border-t pt-2">
                    <div className="flex justify-between items-center font-bold">
                      <span>Net Result</span>
                      <span className={stats.netProfit >= 0 ? 'text-success' : 'text-destructive'}>
                        ${stats.netProfit.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
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
                {sales.map((sale) => (
                  <div key={sale.id} className="flex justify-between items-center p-2 border rounded">
                    <span>Sale #{sale.id.slice(-8)}</span>
                    <div className="text-right">
                      <div className="text-success font-medium">${sale.total_amount}</div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(sale.created_at).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                ))}
                {sales.length === 0 && (
                  <p className="text-muted-foreground text-center py-4">No sales in selected period</p>
                )}
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
                {expenses.map((expense) => (
                  <div key={expense.id} className="flex justify-between items-center p-2 border rounded">
                    <div>
                      <div className="font-medium">{expense.description}</div>
                      <div className="text-xs text-muted-foreground">{expense.category}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-destructive font-medium">-${expense.amount}</div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(expense.created_at).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                ))}
                {expenses.length === 0 && (
                  <p className="text-muted-foreground text-center py-4">No expenses in selected period</p>
                )}
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
                        <span>Average Sale:</span>
                        <span>${sales.length > 0 ? (stats.totalIncome / sales.length).toFixed(2) : '0.00'}</span>
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
      </Tabs>
    </div>
  );
}