import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DollarSign, TrendingUp, Banknote, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useBranchContext } from '@/hooks/useBranchContext';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';

interface StaffSalaryInfo {
  id: string;
  full_name: string;
  salary_percentage: number;
  branch_id: string | null;
  branch_name?: string;
  individualSales: number;
  isPaid: boolean;
  paidAt?: string;
  newSalesAfterPayment: number;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export default function SalaryOverview() {
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [staffList, setStaffList] = useState<StaffSalaryInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState<string | null>(null);
  const [confirmStaff, setConfirmStaff] = useState<StaffSalaryInfo | null>(null);
  const [totalSales, setTotalSales] = useState(0);
  const [totalExpenses, setTotalExpenses] = useState(0);
  const [profit, setProfit] = useState(0);
  const { toast } = useToast();
  const { profile } = useAuth();
  const { selectedBranch } = useBranchContext();

  useEffect(() => {
    fetchAll();

    const salesSubscription = supabase
      .channel('salary-sales-changes')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'sales' },
        () => fetchAll()
      )
      .subscribe();

    return () => { supabase.removeChannel(salesSubscription); };
  }, [selectedBranch, profile, selectedMonth, selectedYear]);

  const getBranchIds = async () => {
    if (!profile) return [];
    if (selectedBranch) return [selectedBranch];
    const { data: branches } = await supabase
      .from('pharmacy_branches')
      .select('id')
      .eq('pharmacy_owner_id', profile.id);
    return (branches || []).map((b: any) => b.id);
  };

  const fetchAll = async () => {
    if (!profile) return;
    setLoading(true);

    const { data: branches } = await supabase
      .from('pharmacy_branches')
      .select('id, name')
      .eq('pharmacy_owner_id', profile.id);

    const branchIds = (branches || []).map((b: any) => b.id);
    const branchMap = new Map((branches || []).map((b: any) => [b.id, b.name]));
    const filteredBranchIds = selectedBranch ? [selectedBranch] : branchIds;

    if (filteredBranchIds.length === 0) {
      setStaffList([]);
      setTotalSales(0);
      setTotalExpenses(0);
      setProfit(0);
      setLoading(false);
      return;
    }

    const startOfMonth = new Date(selectedYear, selectedMonth - 1, 1).toISOString();
    const endOfMonth = new Date(selectedYear, selectedMonth, 0, 23, 59, 59).toISOString();

    // Fetch profit data
    const [salesRes, expensesRes] = await Promise.all([
      supabase.from('sales').select('total_amount').in('branch_id', filteredBranchIds)
        .gte('created_at', startOfMonth).lte('created_at', endOfMonth),
      supabase.from('expenses').select('amount').in('branch_id', filteredBranchIds)
        .gte('created_at', startOfMonth).lte('created_at', endOfMonth),
    ]);

    const ts = (salesRes.data || []).reduce((s, r) => s + Number(r.total_amount), 0);
    const te = (expensesRes.data || []).reduce((s, r) => s + Number(r.amount), 0);
    setTotalSales(ts);
    setTotalExpenses(te);
    setProfit(ts - te);

    // Fetch staff
    let staffQuery = supabase
      .from('profiles')
      .select('id, full_name, salary_percentage, branch_id')
      .eq('role', 'staff')
      .in('branch_id', filteredBranchIds);

    const { data: staffData } = await staffQuery;
    const staffIds = (staffData || []).map((s: any) => s.id);

    if (staffIds.length === 0) {
      setStaffList([]);
      setLoading(false);
      return;
    }

    // Fetch all sales for month per staff
    const { data: allSalesData } = await supabase
      .from('sales')
      .select('sold_by, total_amount, created_at')
      .in('sold_by', staffIds)
      .in('branch_id', filteredBranchIds)
      .gte('created_at', startOfMonth)
      .lte('created_at', endOfMonth);

    // Fetch paid status with payment date
    const { data: paidData } = await supabase
      .from('salary_expenses')
      .select('staff_id, payment_date')
      .in('staff_id', staffIds)
      .eq('month', selectedMonth)
      .eq('year', selectedYear);

    const paidMap: Record<string, string> = {};
    (paidData || []).forEach((r: any) => { paidMap[r.staff_id] = r.payment_date; });

    // Calculate sales totals
    const salesMap: Record<string, number> = {};
    const newSalesMap: Record<string, number> = {};

    (allSalesData || []).forEach((sale: any) => {
      const staffId = sale.sold_by;
      const amount = Number(sale.total_amount);
      salesMap[staffId] = (salesMap[staffId] || 0) + amount;

      // If paid, count sales after payment date
      if (paidMap[staffId]) {
        const paymentDate = new Date(paidMap[staffId]);
        const saleDate = new Date(sale.created_at);
        if (saleDate > paymentDate) {
          newSalesMap[staffId] = (newSalesMap[staffId] || 0) + amount;
        }
      }
    });

    setStaffList((staffData || []).map((s: any) => ({
      ...s,
      salary_percentage: Number(s.salary_percentage) || 0,
      branch_name: s.branch_id ? branchMap.get(s.branch_id) : undefined,
      individualSales: salesMap[s.id] || 0,
      isPaid: !!paidMap[s.id],
      paidAt: paidMap[s.id] || undefined,
      newSalesAfterPayment: newSalesMap[s.id] || 0,
    })));
    setLoading(false);
  };

  const calculateSalary = (staff: StaffSalaryInfo) => {
    if (staff.isPaid) {
      // After payment, only calculate from new sales
      return (staff.newSalesAfterPayment * staff.salary_percentage) / 100;
    }
    return (staff.individualSales * staff.salary_percentage) / 100;
  };

  const handlePaySalary = async (staff: StaffSalaryInfo) => {
    if (!profile) return;
    setPaying(staff.id);
    const salaryAmount = calculateSalary(staff);
    const salesBase = staff.isPaid ? staff.newSalesAfterPayment : staff.individualSales;

    try {
      const { error: salaryError } = await supabase
        .from('salary_expenses')
        .insert({
          staff_id: staff.id,
          branch_id: staff.branch_id || selectedBranch,
          amount: salaryAmount,
          salary_percentage: staff.salary_percentage,
          branch_profit_at_payment: profit,
          payment_date: new Date().toISOString(),
          created_by: profile.id,
          month: selectedMonth,
          year: selectedYear,
          notes: `Salary for ${staff.full_name} - ${selectedMonth}/${selectedYear} (Sales: ETB ${salesBase.toFixed(2)})`,
        });

      if (salaryError) throw salaryError;

      const { error: expenseError } = await supabase
        .from('expenses')
        .insert({
          description: `Salary Payment - ${staff.full_name} (${staff.salary_percentage}% of ETB ${salesBase.toFixed(2)} sales)`,
          amount: salaryAmount,
          category: 'Salary Expense',
          branch_id: staff.branch_id || selectedBranch,
          created_by: profile.id,
        });

      if (expenseError) throw expenseError;

      toast({ title: "Success", description: `Salary of ETB ${salaryAmount.toFixed(2)} paid to ${staff.full_name}` });
      fetchAll();
    } catch (error: any) {
      console.error('Pay salary error:', error);
      toast({ title: "Error", description: error?.message || "Failed to pay salary", variant: "destructive" });
    } finally {
      setPaying(null);
      setConfirmStaff(null);
    }
  };

  // Generate year options
  const yearOptions = [];
  for (let y = now.getFullYear() - 2; y <= now.getFullYear(); y++) {
    yearOptions.push(y);
  }

  if (loading) return <div className="text-sm text-muted-foreground">Loading salary data...</div>;

  return (
    <div className="space-y-4">
      {/* Month/Year Filter */}
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={String(selectedMonth)} onValueChange={(v) => setSelectedMonth(Number(v))}>
          <SelectTrigger className="w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MONTHS.map((m, i) => (
              <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
          <SelectTrigger className="w-[100px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {yearOptions.map(y => (
              <SelectItem key={y} value={String(y)}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={fetchAll}>
          <RefreshCw className="h-4 w-4 mr-1" /> Refresh
        </Button>
      </div>

      {/* Profit Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Monthly Sales</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-success">ETB {totalSales.toFixed(2)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Monthly Expenses</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">ETB {totalExpenses.toFixed(2)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Monthly Profit</CardTitle>
            <Banknote className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${profit >= 0 ? 'text-success' : 'text-destructive'}`}>
              ETB {profit.toFixed(2)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {MONTHS[selectedMonth - 1]} {selectedYear}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Staff Salary Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Banknote className="h-5 w-5" />
            Staff Salary Overview
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Salary = Staff's Individual Sales × Salary %. After payment, only new sales count toward the next payout.
          </p>
        </CardHeader>
        <CardContent>
          {staffList.length === 0 ? (
            <p className="text-muted-foreground text-sm">No staff members found.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Staff Name</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead className="text-right">Total Sales</TableHead>
                  <TableHead className="text-right">Salary %</TableHead>
                  <TableHead className="text-right">Calculated Salary</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {staffList.map(staff => {
                  const salary = calculateSalary(staff);
                  return (
                    <TableRow key={staff.id}>
                      <TableCell className="font-medium">{staff.full_name}</TableCell>
                      <TableCell>{staff.branch_name || '—'}</TableCell>
                      <TableCell className="text-right">
                        ETB {staff.individualSales.toFixed(2)}
                        {staff.isPaid && staff.newSalesAfterPayment > 0 && (
                          <span className="block text-xs text-muted-foreground">
                            New: ETB {staff.newSalesAfterPayment.toFixed(2)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">{staff.salary_percentage}%</TableCell>
                      <TableCell className="text-right font-medium">ETB {salary.toFixed(2)}</TableCell>
                      <TableCell>
                        <Badge variant={staff.isPaid ? 'default' : 'secondary'}>
                          {staff.isPaid ? 'Paid' : 'Unpaid'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          disabled={salary <= 0 || paying === staff.id}
                          onClick={() => setConfirmStaff(staff)}
                        >
                          {paying === staff.id ? 'Paying...' : staff.isPaid ? 'Pay New' : 'Pay Salary'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ConfirmationDialog
        open={!!confirmStaff}
        onOpenChange={(open) => { if (!open) setConfirmStaff(null); }}
        title="Confirm Salary Payment"
        description={confirmStaff ? `Pay ETB ${calculateSalary(confirmStaff).toFixed(2)} to ${confirmStaff.full_name}? (${confirmStaff.salary_percentage}% of ETB ${(confirmStaff.isPaid ? confirmStaff.newSalesAfterPayment : confirmStaff.individualSales).toFixed(2)} sales). This will be recorded as a Salary Expense.` : ''}
        onConfirm={() => confirmStaff && handlePaySalary(confirmStaff)}
        confirmText="Pay Salary"
        cancelText="Cancel"
      />
    </div>
  );
}
