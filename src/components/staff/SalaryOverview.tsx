import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DollarSign, TrendingUp, Banknote, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useBranchContext } from '@/hooks/useBranchContext';
import { useBranchProfit } from '@/hooks/useBranchProfit';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';

interface StaffSalaryInfo {
  id: string;
  full_name: string;
  salary_percentage: number;
  branch_id: string | null;
  branch_name?: string;
  individualSales: number;
}

export default function SalaryOverview() {
  const [staffList, setStaffList] = useState<StaffSalaryInfo[]>([]);
  const [paidMap, setPaidMap] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState<string | null>(null);
  const [confirmStaff, setConfirmStaff] = useState<StaffSalaryInfo | null>(null);
  const { toast } = useToast();
  const { profile } = useAuth();
  const { selectedBranch } = useBranchContext();
  const { profit, totalSales, totalExpenses, month, year, loading: profitLoading, refetch: refetchProfit } = useBranchProfit();

  useEffect(() => {
    fetchStaffSalaries();
  }, [selectedBranch, profile]);

  useEffect(() => {
    if (staffList.length > 0) fetchPaidStatus();
  }, [staffList, month, year]);

  const fetchStaffSalaries = async () => {
    if (!profile) return;
    setLoading(true);

    const { data: branches } = await supabase
      .from('pharmacy_branches')
      .select('id, name')
      .eq('pharmacy_owner_id', profile.id);

    const branchIds = (branches || []).map((b: any) => b.id);
    const branchMap = new Map((branches || []).map((b: any) => [b.id, b.name]));

    let query = supabase
      .from('profiles')
      .select('id, full_name, salary_percentage, branch_id')
      .eq('role', 'staff')
      .in('branch_id', branchIds);

    if (selectedBranch) {
      query = query.eq('branch_id', selectedBranch);
    }

    const { data, error } = await query;
    if (error) {
      console.error('Error fetching staff salaries:', error);
      setLoading(false);
      return;
    }

    // Fetch individual sales for each staff member this month
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();

    const staffIds = (data || []).map((s: any) => s.id);
    let salesMap: Record<string, number> = {};

    if (staffIds.length > 0) {
      let salesQuery = supabase
        .from('sales')
        .select('sold_by, total_amount')
        .in('sold_by', staffIds)
        .gte('created_at', startOfMonth)
        .lte('created_at', endOfMonth);

      if (selectedBranch) {
        salesQuery = salesQuery.eq('branch_id', selectedBranch);
      } else {
        salesQuery = salesQuery.in('branch_id', branchIds);
      }

      const { data: salesData } = await salesQuery;
      (salesData || []).forEach((sale: any) => {
        salesMap[sale.sold_by] = (salesMap[sale.sold_by] || 0) + Number(sale.total_amount);
      });
    }

    setStaffList((data || []).map((s: any) => ({
      ...s,
      salary_percentage: Number(s.salary_percentage) || 0,
      branch_name: s.branch_id ? branchMap.get(s.branch_id) : undefined,
      individualSales: salesMap[s.id] || 0,
    })));
    setLoading(false);
  };

  const fetchPaidStatus = async () => {
    const staffIds = staffList.map(s => s.id);
    if (staffIds.length === 0) return;

    const { data } = await supabase
      .from('salary_expenses')
      .select('staff_id')
      .in('staff_id', staffIds)
      .eq('month', month)
      .eq('year', year);

    const map: Record<string, boolean> = {};
    (data || []).forEach((r: any) => { map[r.staff_id] = true; });
    setPaidMap(map);
  };

  const handleRefresh = () => {
    fetchStaffSalaries();
    refetchProfit();
  };

  const calculateSalary = (staff: StaffSalaryInfo) => {
    return (staff.individualSales * staff.salary_percentage) / 100;
  };

  const handlePaySalary = async (staff: StaffSalaryInfo) => {
    if (!profile) return;
    setPaying(staff.id);

    const salaryAmount = calculateSalary(staff);

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
          month,
          year,
          notes: `Salary for ${staff.full_name} - ${month}/${year} (Individual sales: ETB ${staff.individualSales.toFixed(2)})`,
        });

      if (salaryError) throw salaryError;

      const { error: expenseError } = await supabase
        .from('expenses')
        .insert({
          description: `Salary Payment - ${staff.full_name} (${staff.salary_percentage}% of ETB ${staff.individualSales.toFixed(2)} sales)`,
          amount: salaryAmount,
          category: 'Salary Expense',
          branch_id: staff.branch_id || selectedBranch,
          created_by: profile.id,
        });

      if (expenseError) throw expenseError;

      toast({ title: "Success", description: `Salary of ETB ${salaryAmount.toFixed(2)} paid to ${staff.full_name}` });
      setPaidMap(prev => ({ ...prev, [staff.id]: true }));
      refetchProfit();
    } catch (error: any) {
      console.error('Pay salary error:', error);
      toast({ title: "Error", description: error?.message || "Failed to pay salary", variant: "destructive" });
    } finally {
      setPaying(null);
      setConfirmStaff(null);
    }
  };

  if (loading || profitLoading) return <div className="text-sm text-muted-foreground">Loading salary data...</div>;

  return (
    <div className="space-y-4">
      {/* Branch Monthly Profit Summary */}
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
              {new Date(year, month - 1).toLocaleString('default', { month: 'long', year: 'numeric' })}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Staff Salary Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Banknote className="h-5 w-5" />
              Staff Salary Overview
            </CardTitle>
            <Button variant="outline" size="sm" onClick={handleRefresh}>
              <RefreshCw className="h-4 w-4 mr-1" />
              Refresh
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Salary is calculated as: Staff's Individual Sales × Salary Percentage
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
                  <TableHead className="text-right">Sales This Month</TableHead>
                  <TableHead className="text-right">Salary %</TableHead>
                  <TableHead className="text-right">Calculated Salary</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {staffList.map(staff => {
                  const salary = calculateSalary(staff);
                  const isPaid = paidMap[staff.id] || false;
                  return (
                    <TableRow key={staff.id}>
                      <TableCell className="font-medium">{staff.full_name}</TableCell>
                      <TableCell>{staff.branch_name || '—'}</TableCell>
                      <TableCell className="text-right">ETB {staff.individualSales.toFixed(2)}</TableCell>
                      <TableCell className="text-right">{staff.salary_percentage}%</TableCell>
                      <TableCell className="text-right font-medium">ETB {salary.toFixed(2)}</TableCell>
                      <TableCell>
                        <Badge variant={isPaid ? 'default' : 'secondary'}>
                          {isPaid ? 'Paid' : 'Unpaid'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          disabled={isPaid || salary <= 0 || paying === staff.id}
                          onClick={() => setConfirmStaff(staff)}
                        >
                          {paying === staff.id ? 'Paying...' : 'Pay Salary'}
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
        description={confirmStaff ? `Pay ETB ${calculateSalary(confirmStaff).toFixed(2)} to ${confirmStaff.full_name}? (${confirmStaff.salary_percentage}% of ETB ${confirmStaff.individualSales.toFixed(2)} sales). This will be recorded as a Salary Expense.` : ''}
        onConfirm={() => confirmStaff && handlePaySalary(confirmStaff)}
        confirmText="Pay Salary"
        cancelText="Cancel"
      />
    </div>
  );
}
