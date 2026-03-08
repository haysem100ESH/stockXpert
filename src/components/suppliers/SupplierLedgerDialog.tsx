import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { Download, FileText, Loader2, CalendarIcon } from 'lucide-react';
import { format } from 'date-fns';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import ExcelJS from 'exceljs';

interface SupplierLedgerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplierId: string;
  supplierName: string;
}

interface LedgerEntry {
  id: string;
  date: string;
  referenceId: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
  type: 'purchase' | 'payment';
}

export default function SupplierLedgerDialog({ open, onOpenChange, supplierId, supplierName }: SupplierLedgerDialogProps) {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();
  const [typeFilter, setTypeFilter] = useState('all');

  useEffect(() => {
    if (open && supplierId) fetchLedger();
  }, [open, supplierId]);

  const fetchLedger = async () => {
    setLoading(true);
    try {
      const [{ data: purchases }, { data: payments }] = await Promise.all([
        supabase.from('supplier_purchases').select('*').eq('supplier_id', supplierId).order('created_at', { ascending: true }),
        supabase.from('supplier_payments').select('*').eq('supplier_id', supplierId).order('created_at', { ascending: true }),
      ]);

      const events: { date: string; type: 'purchase' | 'payment'; data: any }[] = [];
      for (const p of purchases || []) events.push({ date: p.created_at, type: 'purchase', data: p });
      for (const p of payments || []) events.push({ date: p.created_at, type: 'payment', data: p });
      events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      let balance = 0;
      const ledger: LedgerEntry[] = events.map(ev => {
        if (ev.type === 'purchase') {
          const cost = Number(ev.data.total_cost);
          const isCredit = ev.data.payment_type === 'credit';
          if (isCredit) balance += cost;
          return {
            id: ev.data.id,
            date: ev.data.created_at,
            referenceId: ev.data.id.slice(0, 8).toUpperCase(),
            description: `Purchase: ${ev.data.item_name} (${ev.data.quantity} × ETB ${Number(ev.data.unit_cost).toFixed(2)})${isCredit ? ' [Credit]' : ' [Paid]'}`,
            debit: isCredit ? cost : 0,
            credit: 0,
            balance,
            type: 'purchase',
          };
        } else {
          const amt = Number(ev.data.amount);
          balance -= amt;
          return {
            id: ev.data.id,
            date: ev.data.created_at,
            referenceId: ev.data.id.slice(0, 8).toUpperCase(),
            description: `Payment (${ev.data.payment_method || 'Cash'})${ev.data.notes ? ' — ' + ev.data.notes : ''}`,
            debit: 0,
            credit: amt,
            balance,
            type: 'payment',
          };
        }
      });

      setEntries(ledger);
    } catch {
      toast({ title: 'Error', description: 'Failed to load supplier ledger', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    return entries.filter(e => {
      if (dateFrom && new Date(e.date) < dateFrom) return false;
      if (dateTo) { const end = new Date(dateTo); end.setHours(23, 59, 59, 999); if (new Date(e.date) > end) return false; }
      if (typeFilter === 'debit' && e.debit === 0) return false;
      if (typeFilter === 'credit' && e.credit === 0) return false;
      return true;
    });
  }, [entries, dateFrom, dateTo, typeFilter]);

  const totalPurchases = filtered.reduce((s, e) => s + e.debit, 0);
  const totalPayments = filtered.reduce((s, e) => s + e.credit, 0);
  const outstandingBalance = entries.length > 0 ? entries[entries.length - 1].balance : 0;

  const exportCSV = () => {
    const headers = ['Date', 'Reference', 'Description', 'Debit (ETB)', 'Credit (ETB)', 'Balance (ETB)'];
    const rows = filtered.map(e => [
      new Date(e.date).toLocaleDateString(), e.referenceId, e.description,
      e.debit > 0 ? e.debit.toFixed(2) : '', e.credit > 0 ? e.credit.toFixed(2) : '', e.balance.toFixed(2),
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${c}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `Supplier_Ledger_${supplierName.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  const exportPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(16); doc.text(`Supplier Ledger — ${supplierName}`, 14, 20);
    doc.setFontSize(10); doc.text(`Generated: ${new Date().toLocaleDateString()}`, 14, 28);
    doc.text(`Outstanding Balance: ETB ${outstandingBalance.toFixed(2)}`, 14, 34);
    autoTable(doc, {
      startY: 42,
      head: [['Date', 'Ref', 'Description', 'Debit', 'Credit', 'Balance']],
      body: filtered.map(e => [
        new Date(e.date).toLocaleDateString(), e.referenceId, e.description,
        e.debit > 0 ? `ETB ${e.debit.toFixed(2)}` : '', e.credit > 0 ? `ETB ${e.credit.toFixed(2)}` : '',
        `ETB ${e.balance.toFixed(2)}`,
      ]),
      styles: { fontSize: 8 }, headStyles: { fillColor: [59, 130, 246] },
    });
    doc.save(`Supplier_Ledger_${supplierName.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[900px] max-h-[90vh] overflow-y-auto p-0">
        <DialogHeader className="p-6 pb-0">
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Supplier Ledger — {supplierName}
          </DialogTitle>
        </DialogHeader>
        <div className="p-6 pt-4 space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground font-medium">Total Purchases (Credit)</p><p className="text-xl font-bold text-foreground">ETB {totalPurchases.toFixed(2)}</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground font-medium">Total Payments</p><p className="text-xl font-bold text-green-600">ETB {totalPayments.toFixed(2)}</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground font-medium">Outstanding Balance</p><p className={`text-xl font-bold ${outstandingBalance > 0 ? 'text-destructive' : 'text-green-600'}`}>ETB {outstandingBalance.toFixed(2)}</p></CardContent></Card>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-2 items-end">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">From</label>
              <Popover><PopoverTrigger asChild><Button variant="outline" size="sm" className="w-[130px] justify-start text-left font-normal"><CalendarIcon className="mr-1 h-3 w-3" />{dateFrom ? format(dateFrom, 'MMM dd, yyyy') : 'Start date'}</Button></PopoverTrigger><PopoverContent className="w-auto p-0" align="start"><Calendar mode="single" selected={dateFrom} onSelect={setDateFrom} /></PopoverContent></Popover>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">To</label>
              <Popover><PopoverTrigger asChild><Button variant="outline" size="sm" className="w-[130px] justify-start text-left font-normal"><CalendarIcon className="mr-1 h-3 w-3" />{dateTo ? format(dateTo, 'MMM dd, yyyy') : 'End date'}</Button></PopoverTrigger><PopoverContent className="w-auto p-0" align="start"><Calendar mode="single" selected={dateTo} onSelect={setDateTo} /></PopoverContent></Popover>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Type</label>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="h-9 w-[120px]"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">All</SelectItem><SelectItem value="debit">Purchases</SelectItem><SelectItem value="credit">Payments</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="flex gap-1 ml-auto">
              <Button size="sm" variant="outline" onClick={exportCSV} disabled={filtered.length === 0}><Download className="h-3 w-3 mr-1" /> CSV</Button>
              <Button size="sm" variant="outline" onClick={exportPDF} disabled={filtered.length === 0}><Download className="h-3 w-3 mr-1" /> PDF</Button>
            </div>
          </div>

          {/* Ledger Table */}
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading ledger...</div>
          ) : (
            <ScrollArea className="w-full rounded-md border">
              <Table className="min-w-[650px]">
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="font-semibold text-xs">Date</TableHead>
                    <TableHead className="font-semibold text-xs">Reference</TableHead>
                    <TableHead className="font-semibold text-xs">Description</TableHead>
                    <TableHead className="font-semibold text-xs text-right">Debit (ETB)</TableHead>
                    <TableHead className="font-semibold text-xs text-right">Credit (ETB)</TableHead>
                    <TableHead className="font-semibold text-xs text-right">Balance (ETB)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground h-24">No ledger entries found</TableCell></TableRow>
                  ) : (
                    filtered.map(entry => (
                      <TableRow key={entry.id} className="hover:bg-muted/20">
                        <TableCell className="text-sm whitespace-nowrap">{new Date(entry.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</TableCell>
                        <TableCell><Badge variant="outline" className="font-mono text-xs">{entry.referenceId}</Badge></TableCell>
                        <TableCell className="text-sm max-w-[250px] truncate">{entry.description}</TableCell>
                        <TableCell className="text-right text-sm">{entry.debit > 0 ? <span className="text-destructive font-medium">{entry.debit.toFixed(2)}</span> : <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell className="text-right text-sm">{entry.credit > 0 ? <span className="text-green-600 font-medium">{entry.credit.toFixed(2)}</span> : <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell className="text-right text-sm font-medium">{entry.balance.toFixed(2)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
