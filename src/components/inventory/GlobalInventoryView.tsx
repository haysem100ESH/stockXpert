import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Search, Globe, AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';

interface LocationStock {
  location_id: string;
  location_name: string;
  location_type: string;
  quantity: number;
}

interface GlobalItem {
  name: string;
  category: string;
  minimum_stock_level: number;
  locations: LocationStock[];
  total: number;
}

export default function GlobalInventoryView() {
  const [items, setItems] = useState<GlobalItem[]>([]);
  const [locationNames, setLocationNames] = useState<{ id: string; name: string; type: string }[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { profile } = useAuth();

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    if (!profile?.id) return;
    try {
      // Fetch locations
      const { data: locs } = await supabase.from('locations').select('id, name, type').eq('pharmacy_owner_id', profile.id).order('name');
      setLocationNames(locs || []);

      // Fetch all medicines across owner's branches
      const { data: branches } = await supabase.from('pharmacy_branches').select('id').eq('pharmacy_owner_id', profile.id);
      const branchIds = (branches || []).map((b: any) => b.id);
      if (branchIds.length === 0) { setLoading(false); return; }

      const { data: medicines } = await supabase.from('medicines')
        .select('name, category, stock_quantity, minimum_stock_level, location_id, branch_id')
        .in('branch_id', branchIds)
        .order('name');

      // Also map branch_id to location via locations table
      const locMap: Record<string, { id: string; name: string; type: string }> = {};
      (locs || []).forEach(l => { locMap[l.id] = l; });

      // Build branch-to-location mapping
      const branchToLoc: Record<string, string> = {};
      (locs || []).forEach((l: any) => {
        // We need to fetch branch_id from locations
      });
      // Fetch locations with branch_id
      const { data: locsWithBranch } = await supabase.from('locations').select('id, branch_id').eq('pharmacy_owner_id', profile.id);
      (locsWithBranch || []).forEach((l: any) => {
        if (l.branch_id) branchToLoc[l.branch_id] = l.id;
      });

      // Group medicines by name
      const grouped = new Map<string, GlobalItem>();
      (medicines || []).forEach((med: any) => {
        const key = med.name;
        if (!grouped.has(key)) {
          grouped.set(key, {
            name: med.name,
            category: med.category,
            minimum_stock_level: med.minimum_stock_level,
            locations: [],
            total: 0,
          });
        }
        const item = grouped.get(key)!;
        // Determine location
        let locId = med.location_id;
        if (!locId && med.branch_id) {
          locId = branchToLoc[med.branch_id];
        }
        if (locId && locMap[locId]) {
          const existing = item.locations.find(l => l.location_id === locId);
          if (existing) {
            existing.quantity += med.stock_quantity;
          } else {
            item.locations.push({
              location_id: locId,
              location_name: locMap[locId].name,
              location_type: locMap[locId].type,
              quantity: med.stock_quantity,
            });
          }
        } else {
          // Unassigned location
          const existing = item.locations.find(l => l.location_id === 'unassigned');
          if (existing) {
            existing.quantity += med.stock_quantity;
          } else {
            item.locations.push({
              location_id: 'unassigned',
              location_name: 'Unassigned',
              location_type: 'unknown',
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

  const allLocIds = [...new Set(items.flatMap(i => i.locations.map(l => l.location_id)))];
  const locColumns = allLocIds.map(id => {
    const loc = items.flatMap(i => i.locations).find(l => l.location_id === id);
    return { id, name: loc?.location_name || 'Unknown' };
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
            <p>Create locations and assign items to see the global view.</p>
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
                    {locColumns.map(col => (
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
                        {locColumns.map(col => {
                          const locStock = item.locations.find(l => l.location_id === col.id);
                          return (
                            <TableCell key={col.id} className="text-center">
                              {locStock ? locStock.quantity : 0}
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
