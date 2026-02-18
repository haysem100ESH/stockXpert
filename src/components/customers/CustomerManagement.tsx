import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Search, Plus, Users, DollarSign, AlertTriangle, Edit, CreditCard, Eye } from 'lucide-react';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useBranchContext } from '@/hooks/useBranchContext';
import AddCustomerDialog from './AddCustomerDialog';
import EditCustomerDialog from './EditCustomerDialog';
import RecordPaymentDialog from './RecordPaymentDialog';
import CustomerDetailDialog from './CustomerDetailDialog';

interface Customer {
  id: string;
  name: string;
  phone?: string | null;
  notes?: string | null;
  created_at: string;
  totalPurchases: number;
  totalPaid: number;
  totalDebt: number;
  lastPurchaseDate?: string;
}

export default function CustomerManagement() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const { profile } = useAuth();
  const { selectedBranch } = useBranchContext();
  const { toast } = useToast();

  useEffect(() => { fetchCustomers(); }, [selectedBranch]);

  const fetchCustomers = async () => {
    try {
      let query = supabase.from('customers').select('*').order('name');
      if (selectedBranch) query = query.eq('branch_id', selectedBranch);
      const { data: customersData, error } = await query;
      if (error) throw error;

      // Fetch sales and payments for each customer
      const enriched: Customer[] = await Promise.all(
        (customersData || []).map(async (c: any) => {
          // Total purchases from sales
          let salesQuery = supabase.from('sales').select('total_amount, created_at').eq('customer_id', c.id).order('created_at', { ascending: false });
          const { data: salesData } = await salesQuery;
          const totalPurchases = salesData?.reduce((sum, s) => sum + Number(s.total_amount), 0) || 0;
          const lastPurchaseDate = salesData?.[0]?.created_at;

          // Total debt payments
          const { data: paymentsData } = await supabase.from('customer_payments').select('amount').eq('customer_id', c.id);
          const totalPayments = paymentsData?.reduce((sum, p) => sum + Number(p.amount), 0) || 0;

          // Amount paid at sale time
          let paidAtSale = 0;
          if (salesData) {
            const saleIds = salesData.map(s => (s as any).id).filter(Boolean);
            // amount_paid is on sales table
            const { data: salesWithPaid } = await supabase.from('sales').select('amount_paid').eq('customer_id', c.id);
            paidAtSale = salesWithPaid?.reduce((sum, s) => sum + Number((s as any).amount_paid || 0), 0) || 0;
          }

          const totalPaid = paidAtSale + totalPayments;
          const totalDebt = Math.max(0, totalPurchases - totalPaid);

          return {
            ...c,
            totalPurchases,
            totalPaid,
            totalDebt,
            lastPurchaseDate,
          };
        })
      );

      setCustomers(enriched);
    } catch (error) {
      toast({ title: "Error", description: "Failed to fetch customers", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const filtered = customers.filter(c =>
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.phone?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totalOutstanding = customers.reduce((sum, c) => sum + c.totalDebt, 0);
  const customersWithDebt = customers.filter(c => c.totalDebt > 0).length;
  const topDebtors = [...customers].sort((a, b) => b.totalDebt - a.totalDebt).filter(c => c.totalDebt > 0).slice(0, 5);

  const getPaymentStatus = (c: Customer) => {
    if (c.totalPurchases === 0) return { label: 'No Sales', variant: 'secondary' as const };
    if (c.totalDebt === 0) return { label: 'Paid', variant: 'default' as const };
    if (c.totalPaid > 0) return { label: 'Partial', variant: 'outline' as const };
    return { label: 'Unpaid', variant: 'destructive' as const };
  };

  if (loading) return <div>Loading customers...</div>;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Customers</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{customers.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Outstanding Debt</CardTitle>
            <DollarSign className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">ETB {totalOutstanding.toFixed(2)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Customers with Debt</CardTitle>
            <AlertTriangle className="h-4 w-4 text-warning" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{customersWithDebt}</div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="all" className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <TabsList>
            <TabsTrigger value="all">All Customers</TabsTrigger>
            <TabsTrigger value="debtors">Debtors</TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search by name or phone..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-8 w-64" />
            </div>
            <Button onClick={() => setShowAddDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />Add Customer
            </Button>
          </div>
        </div>

        <TabsContent value="all">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Total Purchases</TableHead>
                    <TableHead>Paid</TableHead>
                    <TableHead>Outstanding</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No customers found</TableCell></TableRow>
                  ) : filtered.map(c => {
                    const status = getPaymentStatus(c);
                    return (
                      <TableRow key={c.id} className={c.totalDebt > 0 ? 'bg-destructive/5' : ''}>
                        <TableCell className="font-medium">{c.name}</TableCell>
                        <TableCell>{c.phone || '-'}</TableCell>
                        <TableCell>ETB {c.totalPurchases.toFixed(2)}</TableCell>
                        <TableCell>ETB {c.totalPaid.toFixed(2)}</TableCell>
                        <TableCell className={c.totalDebt > 0 ? 'text-destructive font-medium' : ''}>
                          ETB {c.totalDebt.toFixed(2)}
                        </TableCell>
                        <TableCell><Badge variant={status.variant}>{status.label}</Badge></TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button size="sm" variant="ghost" onClick={() => { setSelectedCustomer(c); setShowDetailDialog(true); }}>
                              <Eye className="h-3 w-3" />
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => { setSelectedCustomer(c); setShowEditDialog(true); }}>
                              <Edit className="h-3 w-3" />
                            </Button>
                            {c.totalDebt > 0 && (
                              <Button size="sm" variant="ghost" onClick={() => { setSelectedCustomer(c); setShowPaymentDialog(true); }}>
                                <CreditCard className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="debtors">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Top Debtors</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Outstanding</TableHead>
                    <TableHead>Last Purchase</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customers.filter(c => c.totalDebt > 0).sort((a, b) => b.totalDebt - a.totalDebt).length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No outstanding debts 🎉</TableCell></TableRow>
                  ) : customers.filter(c => c.totalDebt > 0).sort((a, b) => b.totalDebt - a.totalDebt).map(c => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell>{c.phone || '-'}</TableCell>
                      <TableCell className="text-destructive font-medium">ETB {c.totalDebt.toFixed(2)}</TableCell>
                      <TableCell>{c.lastPurchaseDate ? new Date(c.lastPurchaseDate).toLocaleDateString() : '-'}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="outline" onClick={() => { setSelectedCustomer(c); setShowPaymentDialog(true); }}>
                          <CreditCard className="h-3 w-3 mr-1" />Record Payment
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <AddCustomerDialog open={showAddDialog} onOpenChange={setShowAddDialog} onCustomerAdded={fetchCustomers} />
      <EditCustomerDialog open={showEditDialog} onOpenChange={setShowEditDialog} customer={selectedCustomer} onCustomerUpdated={fetchCustomers} />
      {selectedCustomer && (
        <>
          <RecordPaymentDialog
            open={showPaymentDialog}
            onOpenChange={setShowPaymentDialog}
            customerId={selectedCustomer.id}
            customerName={selectedCustomer.name}
            outstandingAmount={selectedCustomer.totalDebt}
            onPaymentRecorded={fetchCustomers}
          />
          <CustomerDetailDialog
            open={showDetailDialog}
            onOpenChange={setShowDetailDialog}
            customerId={selectedCustomer.id}
            customerName={selectedCustomer.name}
          />
        </>
      )}
    </div>
  );
}
