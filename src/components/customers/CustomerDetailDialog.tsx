import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/lib/db';
import { getCreditLimit } from '@/hooks/useCreditScore';
import CreditScoreBadge from './CreditScoreBadge';
import DebtProgressBar from './DebtProgressBar';
import CreditHistoryTab from './CreditHistoryTab';

interface CustomerDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: string;
  customerName: string;
}

interface SaleRecord {
  id: string;
  total_amount: number;
  amount_paid: number;
  payment_status: string;
  payment_method: string;
  created_at: string;
}

interface PaymentRecord {
  id: string;
  amount: number;
  payment_method: string;
  notes: string | null;
  created_at: string;
}

export default function CustomerDetailDialog({ open, onOpenChange, customerId, customerName }: CustomerDetailDialogProps) {
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [creditScore, setCreditScore] = useState(50);
  const [currentDebt, setCurrentDebt] = useState(0);
  const [maxCreditLimit, setMaxCreditLimit] = useState(5000);

  useEffect(() => {
    if (open && customerId) {
      fetchData();
    }
  }, [open, customerId]);

  const fetchData = async () => {
    setLoading(true);
    const [salesRes, paymentsRes, customerRes] = await Promise.all([
      supabase.from('sales').select('id, total_amount, amount_paid, payment_status, payment_method, created_at').eq('customer_id', customerId).order('created_at', { ascending: false }),
      supabase.from('customer_payments').select('id, amount, payment_method, notes, created_at').eq('customer_id', customerId).order('created_at', { ascending: false }),
      supabase.from('customers').select('credit_score, max_credit_limit').eq('id', customerId).single(),
    ]);
    const salesData = (salesRes.data as any[]) || [];
    setSales(salesData);
    setPayments(paymentsRes.data || []);

    const score = (customerRes as any).data?.credit_score ?? 50;
    setCreditScore(score);
    setMaxCreditLimit((customerRes as any).data?.max_credit_limit ?? getCreditLimit(score));

    // Compute debt
    const totalPurchases = salesData.reduce((s: number, r: any) => s + Number(r.total_amount), 0);
    const paidAtSale = salesData.reduce((s: number, r: any) => s + Number(r.amount_paid || 0), 0);
    const totalPayments = (paymentsRes.data || []).reduce((s: number, p: any) => s + Number(p.amount), 0);
    setCurrentDebt(Math.max(0, totalPurchases - paidAtSale - totalPayments));

    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{customerName} — History</DialogTitle>
          <DialogDescription>Purchase and payment history for this customer.</DialogDescription>
        </DialogHeader>

        {loading ? <div className="py-4 text-center text-muted-foreground">Loading...</div> : (
          <>
            {/* Credit Score Summary */}
            <div className="flex items-center gap-4 flex-wrap p-3 rounded-lg border bg-card">
              <CreditScoreBadge score={creditScore} size="md" />
              <div className="flex-1 min-w-[180px]">
                <DebtProgressBar currentDebt={currentDebt} maxCreditLimit={maxCreditLimit} />
              </div>
            </div>

            <Tabs defaultValue="purchases" className="space-y-4">
              <TabsList>
                <TabsTrigger value="purchases">Purchases ({sales.length})</TabsTrigger>
                <TabsTrigger value="payments">Debt Payments ({payments.length})</TabsTrigger>
                <TabsTrigger value="credit">Credit History</TabsTrigger>
              </TabsList>

            <TabsContent value="purchases">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>Paid</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sales.length === 0 ? (
                    <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No purchases</TableCell></TableRow>
                  ) : sales.map(s => (
                    <TableRow key={s.id}>
                      <TableCell>{new Date(s.created_at).toLocaleDateString()}</TableCell>
                      <TableCell>ETB {Number(s.total_amount).toFixed(2)}</TableCell>
                      <TableCell>ETB {Number(s.amount_paid || 0).toFixed(2)}</TableCell>
                      <TableCell>
                        <Badge variant={s.payment_status === 'paid' ? 'default' : s.payment_status === 'partial' ? 'outline' : 'destructive'}>
                          {s.payment_status === 'paid' ? 'Paid' : s.payment_status === 'partial' ? 'Partial' : 'Unpaid'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TabsContent>

            <TabsContent value="payments">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.length === 0 ? (
                    <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No debt payments</TableCell></TableRow>
                  ) : payments.map(p => (
                    <TableRow key={p.id}>
                      <TableCell>{new Date(p.created_at).toLocaleDateString()}</TableCell>
                      <TableCell className="text-success font-medium">ETB {Number(p.amount).toFixed(2)}</TableCell>
                      <TableCell>{p.payment_method}</TableCell>
                      <TableCell>{p.notes || '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TabsContent>
            <TabsContent value="credit">
              <CreditHistoryTab customerId={customerId} />
            </TabsContent>
          </Tabs>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
