import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertTriangle, Package, CalendarDays, Settings2 } from 'lucide-react';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { useBranchContext } from '@/hooks/useBranchContext';
import { useAuth } from '@/hooks/useAuth';
import { useExpiryThreshold } from '@/hooks/useExpiryThreshold';

interface AlertItem {
  id: string;
  name: string;
  category: string;
  quantity: number;
  minimum_stock_level?: number;
  expiry_date?: string;
}

export default function InventoryDashboard() {
  const [outOfStockItems, setOutOfStockItems] = useState<AlertItem[]>([]);
  const [lowStockItems, setLowStockItems] = useState<AlertItem[]>([]);
  const [expiringItems, setExpiringItems] = useState<AlertItem[]>([]);
  const [expiredItems, setExpiredItems] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    open: boolean;
    itemId: string;
    itemName: string;
  }>({ open: false, itemId: '', itemName: '' });
  const { toast } = useToast();
  const { selectedBranch, branchType } = useBranchContext();
  const { profile } = useAuth();
  const { days: thresholdDays, setDays: setThresholdDays, defaultDays } = useExpiryThreshold();
  const [thresholdInput, setThresholdInput] = useState<string>(String(thresholdDays));
  const isPharmacy = branchType === 'pharmacy';

  useEffect(() => { setThresholdInput(String(thresholdDays)); }, [thresholdDays]);

  useEffect(() => {
    fetchInventoryData();
  }, [selectedBranch, thresholdDays]);

  useEffect(() => {
    const channel = supabase
      .channel('branch-items-changes')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'branch_items' },
        () => fetchInventoryData()
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const fetchInventoryData = async () => {
    try {
      let ownerBranchIds: string[] = [];
      if (!selectedBranch && profile?.role === 'owner' && profile?.id) {
        const { data: ownerBranches } = await supabase
          .from('pharmacy_branches')
          .select('id')
          .eq('pharmacy_owner_id', profile.id);
        ownerBranchIds = (ownerBranches || []).map((b: any) => b.id);
      }

      if (!selectedBranch && ownerBranchIds.length === 0 && profile?.role === 'owner') {
        setOutOfStockItems([]); setLowStockItems([]); setExpiringItems([]); setExpiredItems([]);
        setLoading(false);
        return;
      }

      // Fetch all branch_items with medicine details
      let query = supabase
        .from('branch_items')
        .select('id, quantity, expiry_date, medicines!inner(name, category, minimum_stock_level)');

      if (selectedBranch) {
        query = query.eq('branch_id', selectedBranch);
      } else if (ownerBranchIds.length > 0) {
        query = query.in('branch_id', ownerBranchIds);
      }

      const { data, error } = await query;
      if (error) throw error;

      const items = (data || []).map((bi: any) => ({
        id: bi.id,
        name: bi.medicines?.name || 'Unknown',
        category: bi.medicines?.category || 'Uncategorized',
        quantity: bi.quantity,
        minimum_stock_level: bi.medicines?.minimum_stock_level || 0,
        expiry_date: bi.expiry_date,
      }));

      const outOfStock = items.filter(i => i.quantity === 0);
      const lowStock = items.filter(i => i.quantity > 0 && i.minimum_stock_level && i.quantity <= i.minimum_stock_level);

      const today = new Date().toISOString().split('T')[0];
      const thresholdDate = new Date();
      thresholdDate.setDate(thresholdDate.getDate() + thresholdDays);
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toISOString().split('T')[0];
      const thresholdStr = thresholdDate.toISOString().split('T')[0];

      const expiring = items.filter(i => i.expiry_date && i.quantity > 0 && i.expiry_date >= tomorrowStr && i.expiry_date <= thresholdStr);
      const expired = items.filter(i => i.expiry_date && i.quantity > 0 && i.expiry_date <= today);

      setOutOfStockItems(outOfStock);
      setLowStockItems(lowStock);
      setExpiringItems(expiring);
      setExpiredItems(expired);
    } catch (error) {
      console.error('Error fetching inventory data:', error);
      toast({ title: "Error", description: "Failed to fetch inventory data", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveExpiredItem = (itemId: string, itemName: string) => {
    setDeleteConfirm({ open: true, itemId, itemName });
  };

  const confirmRemoveExpiredItem = async () => {
    try {
      const { error } = await supabase
        .from('branch_items')
        .update({ quantity: 0 })
        .eq('id', deleteConfirm.itemId);

      if (error) throw error;

      setExpiredItems(expiredItems.filter(item => item.id !== deleteConfirm.itemId));
      toast({ title: "Success", description: "Expired item stock set to 0" });
      setDeleteConfirm({ open: false, itemId: '', itemName: '' });
    } catch (error) {
      console.error('Error updating expired item:', error);
      toast({ title: "Error", description: "Failed to update expired item", variant: "destructive" });
    }
  };

  if (loading) {
    return <div>Loading inventory data...</div>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row sm:items-end gap-3">
            <div className="flex-1">
              <Label htmlFor="expiry-threshold" className="flex items-center gap-2 mb-1">
                <Settings2 className="h-4 w-4" />
                Expiry alert threshold
              </Label>
              <p className="text-xs text-muted-foreground">
                Items expiring within this many days will appear in alerts. Default: {defaultDays} days (≈ 2 months).
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                id="expiry-threshold"
                type="number"
                min={1}
                max={365}
                value={thresholdInput}
                onChange={(e) => setThresholdInput(e.target.value)}
                className="w-24"
              />
              <span className="text-sm text-muted-foreground">days</span>
              <Button
                size="sm"
                onClick={() => {
                  const n = parseInt(thresholdInput, 10);
                  if (Number.isFinite(n) && n > 0) setThresholdDays(n);
                  else setThresholdInput(String(thresholdDays));
                }}
              >
                Save
              </Button>
              {thresholdDays !== defaultDays && (
                <Button size="sm" variant="ghost" onClick={() => setThresholdDays(defaultDays)}>
                  Reset
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {outOfStockItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Package className="h-5 w-5 text-destructive" />
              <span>Out of Stock Products</span>
            </CardTitle>
            <CardDescription>{outOfStockItems.length} products are currently out of stock</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2">
              {outOfStockItems.map((item) => (
                <div key={item.id} className="flex items-center justify-between p-2 border rounded-lg">
                  <div>
                    <p className="font-medium">{item.name}</p>
                    <p className="text-sm text-muted-foreground">{item.category}</p>
                  </div>
                  <Badge variant="destructive">Out of Stock</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {lowStockItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <AlertTriangle className="h-5 w-5 text-warning" />
              <span>Low Stock Items</span>
            </CardTitle>
            <CardDescription>{lowStockItems.length} items are running low on stock</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2">
              {lowStockItems.map((item) => (
                <div key={item.id} className="flex items-center justify-between p-2 border rounded-lg">
                  <div>
                    <p className="font-medium">{item.name}</p>
                    <p className="text-sm text-muted-foreground">{item.category}</p>
                  </div>
                  <div className="text-right">
                    <Badge variant="secondary">{item.quantity} left</Badge>
                    <p className="text-xs text-muted-foreground">Min: {item.minimum_stock_level}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {expiringItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <CalendarDays className="h-5 w-5 text-warning" />
              <span>Items Expiring Soon</span>
            </CardTitle>
            <CardDescription>{expiringItems.length} items will expire within 30 days</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2">
              {expiringItems.map((item) => (
                <div key={item.id} className="flex items-center justify-between p-2 border rounded-lg">
                  <div>
                    <p className="font-medium">{item.name}</p>
                    <p className="text-sm text-muted-foreground">{item.category}</p>
                  </div>
                  <div className="text-right">
                    <Badge variant="secondary">{item.quantity} in stock</Badge>
                    <p className="text-xs text-warning">
                      Expires: {new Date(item.expiry_date!).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {expiredItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <span>Expired Items</span>
            </CardTitle>
            <CardDescription>{expiredItems.length} items have expired and should be removed</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2">
              {expiredItems.map((item) => (
                <div key={item.id} className="flex items-center justify-between p-2 border rounded-lg bg-destructive/5">
                  <div>
                    <p className="font-medium">{item.name}</p>
                    <p className="text-sm text-muted-foreground">{item.category}</p>
                    <p className="text-xs text-destructive">
                      Expired: {new Date(item.expiry_date!).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Badge variant="destructive">Expired</Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleRemoveExpiredItem(item.id, item.name)}
                      className="text-destructive hover:text-destructive"
                    >
                      Set Stock to 0
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {outOfStockItems.length === 0 && lowStockItems.length === 0 && 
       expiringItems.length === 0 && expiredItems.length === 0 && (
        <Card>
          <CardContent className="text-center py-8">
            <Package className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">All Good!</h3>
            <p className="text-muted-foreground">
              No inventory issues detected. All products are well-stocked and within expiry dates.
            </p>
          </CardContent>
        </Card>
      )}

      <ConfirmationDialog
        open={deleteConfirm.open}
        onOpenChange={(open) => setDeleteConfirm(prev => ({ ...prev, open }))}
        title="Set Stock to Zero"
        description={`Are you sure you want to set the stock of "${deleteConfirm.itemName}" to 0?`}
        onConfirm={confirmRemoveExpiredItem}
        confirmText="Set to 0"
        cancelText="Cancel"
      />
    </div>
  );
}
