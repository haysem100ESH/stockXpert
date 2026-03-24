import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Search, Globe, AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';

interface BranchStock {
  branch_id: string;
  branch_name: string;
  branch_type: string;
  quantity: number;
}

interface GlobalItem {
  name: string;
  category: string;
  minimum_stock_level: number;
  branches: BranchStock[];
  total: number;
}

export default function GlobalInventoryView() {
  const [items, setItems] = useState<GlobalItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { profile } = useAuth();

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    if (!profile?.id) return;
    try {
      // Fetch all branches for this owner
      const { data: branches } = await supabase.from('pharmacy_branches').select('id, name, branch_type').eq('pharmacy_owner_id', profile.id).order('name');
      const branchIds = (branches || []).map((b: any) => b.id);
      if (branchIds.length === 0) { setLoading(false); return; }

      const branchMap: Record<string, { name: string; type: string }> = {};
      (branches || []).forEach((b: any) => { branchMap[b.id] = { name: b.name, type: b.branch_type }; });

      const { data: medicines } = await supabase.from('medicines')
        .select('name, category, stock_quantity, minimum_stock_level, branch_id')
        .in('branch_id', branchIds)
        .order('name');

      // Group medicines by name
      const grouped = new Map<string, GlobalItem>();
      (medicines || []).forEach((med: any) => {
        const key = med.name;
        if (!grouped.has(key)) {
          grouped.set(key, {
            name: med.name,
            category: med.category,
            minimum_stock_level: med.minimum_stock_level,
            branches: [],
            total: 0,
          });
        }
        const item = grouped.get(key)!;
        const branchInfo = branchMap[med.branch_id];
        if (branchInfo) {
          const existing = item.branches.find(b => b.branch_id === med.branch_id);
          if (existing) {
            existing.quantity += med.stock_quantity;
          } else {
            item.branches.push({
              branch_id: med.branch_id,
              branch_name: branchInfo.name,
              branch_type: branchInfo.type,
              quantity: med.stock_quantity,
            });
          }
        }
        item.total += med.stock_quantity;
      });

      setItems(Array.from(grouped.values()).sort((a, b) => a.name.localeCompare(b.name)));
    } catch {
      toast({ title: 'Error', description: 'Failed to fetch global inventory', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const allBranchIds = [...new Set(items.flatMap(i => i.branches.map(b => b.branch_id)))];
  const branchColumns = allBranchIds.map(id => {
    const branch = items.flatMap(i => i.branches).find(b => b.branch_id === id);
    return { id, name: branch?.branch_name || 'Unknown' };
  });

  const filtered = items.filter(i => i.name.toLowerCase().includes(searchTerm.toLowerCase()));

  if (loading) return <div>Loading global inventory...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-2">
          <Globe className="h-6 w-6 text-primary" />
          <h2 className="text-2xl font-bold">Global Inventory</h2>
        </div>
        <div className="relative w-72">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search items..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-8" />
        </div>
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Globe className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p className="text-lg font-medium mb-2">No inventory data</p>
            <p>Create branches and add items to see the global view.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky left-0 bg-background z-10">Item</TableHead>
                    <TableHead>Category</TableHead>
                    {branchColumns.map(col => (
                      <TableHead key={col.id} className="text-center">{col.name}</TableHead>
                    ))}
                    <TableHead className="text-center font-bold">Total</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(item => {
                    const isLow = item.total > 0 && item.total <= item.minimum_stock_level;
                    const isOut = item.total === 0;
                    return (
                      <TableRow key={item.name}>
                        <TableCell className="sticky left-0 bg-background z-10 font-medium">{item.name}</TableCell>
                        <TableCell><Badge variant="outline">{item.category}</Badge></TableCell>
                        {branchColumns.map(col => {
                          const branchStock = item.branches.find(b => b.branch_id === col.id);
                          return (
                            <TableCell key={col.id} className="text-center">
                              {branchStock ? branchStock.quantity : 0}
                            </TableCell>
                          );
                        })}
                        <TableCell className="text-center font-bold">{item.total}</TableCell>
                        <TableCell>
                          {isOut && <Badge variant="destructive" className="text-xs">Out</Badge>}
                          {isLow && (
                            <Badge variant="outline" className="text-xs text-yellow-600 border-yellow-400">
                              <AlertTriangle className="h-3 w-3 mr-1" />Low
                            </Badge>
                          )}
                          {!isOut && !isLow && <Badge variant="secondary" className="text-xs">OK</Badge>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}