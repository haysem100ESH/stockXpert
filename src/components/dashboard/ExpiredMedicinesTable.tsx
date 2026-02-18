import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { useBranchContext } from '@/hooks/useBranchContext';

interface ExpiredMedicine {
  id: string;
  name: string;
  batch_number?: string;
  expiry_date: string;
  stock_quantity: number;
}

export default function ExpiredMedicinesTable() {
  const [expiredMedicines, setExpiredMedicines] = useState<ExpiredMedicine[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [medicineToDelete, setMedicineToDelete] = useState<string | null>(null);
  const { toast } = useToast();
  const { selectedBranch } = useBranchContext();

  useEffect(() => {
    fetchExpiredMedicines();
  }, [selectedBranch]);

  const fetchExpiredMedicines = async () => {
    try {
      let query = supabase
        .from('medicines')
        .select('id, name, batch_number, expiry_date, stock_quantity')
        .not('expiry_date', 'is', null)
        .lt('expiry_date', new Date().toISOString().split('T')[0]);

      // Filter by selected branch if one is selected
      if (selectedBranch) {
        query = query.eq('branch_id', selectedBranch);
      }

      const { data, error } = await query.order('expiry_date', { ascending: true });

      if (error) throw error;
      setExpiredMedicines(data || []);
    } catch (error) {
      console.error('Error fetching expired medicines:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteMedicine = (medicineId: string) => {
    setMedicineToDelete(medicineId);
    setDeleteConfirm(true);
  };

  const confirmDeleteMedicine = async () => {
    if (!medicineToDelete) return;

    setDeleteConfirm(false);

    try {
      const { error } = await supabase
        .from('medicines')
        .delete()
        .eq('id', medicineToDelete);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Expired medicine removed successfully"
      });

      // Remove from local state
      setExpiredMedicines(expiredMedicines.filter(item => item.id !== medicineToDelete));
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to remove expired medicine",
        variant: "destructive"
      });
    } finally {
      setMedicineToDelete(null);
    }
  };

  if (loading) {
    return <div>Loading expired medicines...</div>;
  }

  if (expiredMedicines.length === 0) {
    return null;
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <span>Expired Medicines</span>
          </CardTitle>
          <CardDescription>
            {expiredMedicines.length} medicines have expired and should be removed from inventory
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Medicine Name</TableHead>
                <TableHead>Batch Number</TableHead>
                <TableHead>Expiry Date</TableHead>
                <TableHead>Quantity</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {expiredMedicines.map((medicine) => (
                <TableRow key={medicine.id}>
                  <TableCell className="font-medium">{medicine.name}</TableCell>
                  <TableCell>{medicine.batch_number || '-'}</TableCell>
                  <TableCell className="text-destructive">
                    {new Date(medicine.expiry_date).toLocaleDateString()}
                  </TableCell>
                  <TableCell>{medicine.stock_quantity}</TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => handleDeleteMedicine(medicine.id)}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Remove
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ConfirmationDialog
        open={deleteConfirm}
        onOpenChange={setDeleteConfirm}
        title="Remove Expired Medicine"
        description="Are you sure you want to remove this expired medicine from inventory? This action cannot be undone."
        onConfirm={confirmDeleteMedicine}
        confirmText="Remove"
      />
    </>
  );
}