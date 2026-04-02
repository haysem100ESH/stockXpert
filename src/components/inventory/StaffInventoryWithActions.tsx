import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Search, Edit2, Plus, Trash2, Filter, Settings2, SlidersHorizontal, History, Layers } from 'lucide-react';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useBranchContext } from '@/hooks/useBranchContext';
import AddBranchItemDialog from './AddBranchItemDialog';
import EditBranchItemDialog, { type BranchItem } from './EditBranchItemDialog';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import CategoryManagement from './CategoryManagement';
import StockEditHistory from './StockEditHistory';
import BatchBreakdownDialog from './BatchBreakdownDialog';

export default function StaffInventoryWithActions() {
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'inventory';
  const [activeTab, setActiveTab] = useState(initialTab);
  const [branchItems, setBranchItems] = useState<BranchItem[]>([]);
  const [filteredItems, setFilteredItems] = useState<BranchItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingItem, setEditingItem] = useState<BranchItem | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState<{
    open: boolean;
    itemId: string;
    itemName: string;
  }>({ open: false, itemId: '', itemName: '' });
  const [hasBranches, setHasBranches] = useState(true);
  const [batchBreakdown, setBatchBreakdown] = useState<{ open: boolean; itemId: string; itemName: string }>({ open: false, itemId: '', itemName: '' });
  const { toast } = useToast();
  const { profile } = useAuth();
  const { selectedBranch, branchType } = useBranchContext();
  const isPharmacy = branchType === 'pharmacy';

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab) setActiveTab(tab);
  }, [searchParams]);

  useEffect(() => {
    if (profile) {
      setLoading(true);
      fetchBranchItems();
      checkBranches();
    }
  }, [selectedBranch, profile?.id]);

  const checkBranches = async () => {
    try {
      let query = supabase.from('pharmacy_branches').select('id').limit(1);
      if (profile?.role === 'owner' && profile?.id) {
        query = query.eq('pharmacy_owner_id', profile.id);
      }
      const { data, error } = await query;
      if (error) throw error;
      setHasBranches(data && data.length > 0);
    } catch (error) {
      console.error('Error checking branches:', error);
    }
  };

  useEffect(() => {
    const medicineCategories = ['tablet', 'capsule', 'syrup', 'injection', 'cream', 'ointment', 'drops', 'inhaler'];
    
    const filtered = branchItems.filter(item => {
      const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (item.generic_name || '').toLowerCase().includes(searchTerm.toLowerCase());
      
      let matchesCategory = true;
      if (categoryFilter === 'medicines_only') {
        matchesCategory = medicineCategories.includes(item.category);
      } else if (categoryFilter !== 'all') {
        matchesCategory = item.category === categoryFilter;
      }
      
      return matchesSearch && matchesCategory;
    });
    setFilteredItems(filtered);
  }, [branchItems, searchTerm, categoryFilter]);

  const fetchBranchItems = async () => {
    try {
      // Get branch IDs for this owner
      let branchIds: string[] = [];
      if (selectedBranch) {
        branchIds = [selectedBranch];
      } else if (profile?.role === 'owner' && profile?.id) {
        const { data: ownerBranches } = await supabase
          .from('pharmacy_branches')
          .select('id')
          .eq('pharmacy_owner_id', profile.id);
        branchIds = (ownerBranches || []).map((b: any) => b.id);
      } else if (profile?.branch_id) {
        branchIds = [profile.branch_id];
      }

      if (branchIds.length === 0) {
        setBranchItems([]);
        setLoading(false);
        return;
      }

      // Fetch branch_items
      let query = supabase
        .from('branch_items')
        .select('id, medicine_id, branch_id, owner_id, selling_price, purchase_price, quantity, expiry_date')
        .in('branch_id', branchIds)
        .order('created_at', { ascending: false });

      const { data: items, error } = await query;
      if (error) throw error;

      if (!items || items.length === 0) {
        setBranchItems([]);
        setLoading(false);
        return;
      }

      // Fetch medicine details
      const medicineIds = [...new Set(items.map((i: any) => i.medicine_id))];
      const { data: meds } = await supabase
        .from('medicines')
        .select('id, name, generic_name, category, manufacturer, batch_number, item_type, unit_label, units_per_pack')
        .in('id', medicineIds);

      const medMap: Record<string, any> = {};
      (meds || []).forEach((m: any) => { medMap[m.id] = m; });

      // Fetch branch names
      const allBranchIds = [...new Set(items.map((i: any) => i.branch_id))];
      const branchMap: Record<string, string> = {};
      if (allBranchIds.length > 0) {
        const { data: branches } = await supabase
          .from('pharmacy_branches')
          .select('id, name')
          .in('id', allBranchIds);
        (branches || []).forEach((b: any) => { branchMap[b.id] = b.name; });
      }

      const merged: BranchItem[] = items.map((item: any) => {
        const med = medMap[item.medicine_id] || {};
        return {
          ...item,
          name: med.name || 'Unknown',
          generic_name: med.generic_name,
          category: med.category || 'Uncategorized',
          manufacturer: med.manufacturer,
          batch_number: med.batch_number,
          item_type: med.item_type,
          unit_label: med.unit_label,
          units_per_pack: med.units_per_pack,
          branch_name: branchMap[item.branch_id],
        };
      });

      setBranchItems(merged);
    } catch (error) {
      toast({
        title: 'Error',
        description: `Failed to fetch ${isPharmacy ? 'medicines' : 'items'}`,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleItemAdded = () => {
    fetchBranchItems();
    setShowAddDialog(false);
  };

  const handleEditItem = (item: BranchItem) => {
    setEditingItem(item);
  };

  const handleItemUpdated = () => {
    fetchBranchItems();
    setEditingItem(null);
  };

  const handleDeleteItem = (itemId: string, itemName: string) => {
    setDeleteConfirmation({ open: true, itemId, itemName });
  };

  const confirmDeleteItem = async () => {
    try {
      const itemId = deleteConfirmation.itemId;

      // Check if item has sales history (sale_items referencing this branch_item)
      const { count: saleCount } = await supabase
        .from('sale_items')
        .select('id', { count: 'exact', head: true })
        .eq('branch_item_id', itemId);

      if ((saleCount ?? 0) > 0) {
        toast({
          title: 'Cannot Delete',
          description: `This item has sales history and cannot be removed. You can set its stock to 0 instead.`,
          variant: 'destructive',
        });
        setDeleteConfirmation({ open: false, itemId: '', itemName: '' });
        return;
      }

      // Delete related inventory_batches first (no sales history means batches are unused)
      await supabase.from('inventory_batches').delete().eq('branch_item_id', itemId);

      const { error } = await supabase.from('branch_items').delete().eq('id', itemId);
      if (error) throw error;
      setBranchItems(prev => prev.filter(i => i.id !== itemId));
      toast({ title: 'Success', description: `${isPharmacy ? 'Medicine' : 'Item'} removed from branch` });
      setDeleteConfirmation({ open: false, itemId: '', itemName: '' });
    } catch (error) {
      toast({ title: 'Error', description: `Failed to delete ${isPharmacy ? 'medicine' : 'item'}. It may have related records.`, variant: 'destructive' });
    }
  };

  const isOutOfStock = (item: BranchItem) => item.quantity === 0;
  const isLowStock = (item: BranchItem) => item.quantity > 0 && item.quantity <= 10;
  const getUniqueCategories = () => [...new Set(branchItems.map(i => i.category))].sort();

  const isExpired = (item: BranchItem) => {
    if (!item.expiry_date) return false;
    const expiry = new Date(item.expiry_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    expiry.setHours(0, 0, 0, 0);
    return expiry <= today;
  };

  const isExpiringSoon = (item: BranchItem) => {
    if (!item.expiry_date || isExpired(item)) return false;
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
    return new Date(item.expiry_date) <= thirtyDaysFromNow;
  };

  const renderItemCard = (item: BranchItem & { branch_name?: string }) => (
    <Card key={item.id} className={isExpired(item) ? 'border-destructive/30 bg-destructive/5' : ''}>
      <CardHeader>
        <div className="flex justify-between items-start">
          <div className="flex-1">
            <CardTitle className="text-lg">{item.name}</CardTitle>
            {item.generic_name && <CardDescription>{item.generic_name}</CardDescription>}
          </div>
          <div className="flex space-x-1">
            <Button size="sm" variant="ghost" onClick={() => setBatchBreakdown({ open: true, itemId: item.id, itemName: item.name })} title="View Batches"><Layers className="h-4 w-4" /></Button>
            <Button size="sm" variant="ghost" onClick={() => handleEditItem(item)} title="Edit"><Edit2 className="h-4 w-4" /></Button>
            <Button size="sm" variant="ghost" onClick={() => handleDeleteItem(item.id, item.name)} title="Remove"><Trash2 className="h-4 w-4" /></Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <div className="flex justify-between text-sm"><span>Category:</span><Badge variant="outline">{item.category}</Badge></div>
          {isPharmacy && item.batch_number && <div className="flex justify-between text-sm"><span>Batch:</span><span>{item.batch_number}</span></div>}
          {item.manufacturer && <div className="flex justify-between text-sm"><span>{isPharmacy ? 'Manufacturer' : 'Brand'}:</span><span>{item.manufacturer}</span></div>}
          <div className="flex justify-between text-sm"><span>Selling Price:</span><span className="font-medium">ETB {item.selling_price}</span></div>
          <div className="flex justify-between text-sm"><span>Cost Price:</span><span className="text-muted-foreground">ETB {item.purchase_price}</span></div>
          <div className="flex justify-between text-sm items-center">
            <span>Stock:</span>
            <div className="flex items-center space-x-2">
              <span className={(isLowStock(item) || isOutOfStock(item)) ? 'text-warning font-medium' : ''}>{item.quantity}</span>
              {isOutOfStock(item) && <Badge variant="destructive" className="text-xs">Out of Stock</Badge>}
              {isLowStock(item) && <Badge variant="destructive" className="text-xs">Low Stock</Badge>}
            </div>
          </div>
          {item.branch_name && !selectedBranch && (
            <div className="flex justify-between text-sm"><span>Branch:</span><Badge variant="outline">{item.branch_name}</Badge></div>
          )}
          {isPharmacy && item.expiry_date && (
            <div className="flex justify-between text-sm">
              <span>Expiry:</span>
              <div className="flex items-center space-x-2">
                <span className={isExpired(item) ? 'text-destructive font-medium' : isExpiringSoon(item) ? 'text-warning' : ''}>
                  {new Date(item.expiry_date).toLocaleDateString()}
                </span>
                {isExpired(item) && <Badge variant="destructive" className="text-xs">Expired</Badge>}
                {!isExpired(item) && isExpiringSoon(item) && <Badge variant="secondary" className="text-xs">Expiring Soon</Badge>}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 gap-3">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <span className="text-muted-foreground">Loading {isPharmacy ? 'medicines' : 'items'}...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h2 className="text-xl sm:text-2xl font-bold">{isPharmacy ? 'Inventory Management' : 'Stock Management'}</h2>
          <div className="flex gap-2 flex-wrap">
            <Button onClick={() => setShowAddDialog(true)} disabled={!hasBranches} size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Add Item
            </Button>
          </div>
        </div>
        {!hasBranches && (
          <div className="bg-warning/10 border border-warning/30 rounded-lg p-4">
            <p className="text-sm text-warning">
              ⚠️ Please create a branch first before adding {isPharmacy ? 'medicines' : 'items'}.
            </p>
          </div>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-3 h-auto">
          <TabsTrigger value="inventory" className="text-xs sm:text-sm">{isPharmacy ? 'Medicines & Items' : 'Items'}</TabsTrigger>
          <TabsTrigger value="stock-history" className="text-xs sm:text-sm">
            <History className="h-3.5 w-3.5 mr-1" />
            Stock History
          </TabsTrigger>
          <TabsTrigger value="categories" className="text-xs sm:text-sm">Categories</TabsTrigger>
        </TabsList>

        <TabsContent value="inventory" className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={isPharmacy ? 'Search medicines...' : 'Search items...'}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8"
              />
            </div>
            <div className="flex items-center space-x-2">
              <Filter className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-full sm:w-48">
                  <SelectValue placeholder="Filter by category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {isPharmacy && <SelectItem value="medicines_only">Medicines Only</SelectItem>}
                  {getUniqueCategories().map(cat => (
                    <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Group by branch when "All Branches" */}
          {!selectedBranch && branchItems.some((i: any) => i.branch_name) ? (
            (() => {
              const grouped: Record<string, (BranchItem & { branch_name?: string })[]> = {};
              filteredItems.forEach((i: any) => {
                const key = i.branch_name || 'Unknown Branch';
                if (!grouped[key]) grouped[key] = [];
                grouped[key].push(i);
              });
              return Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([branchName, items]) => (
                <div key={branchName} className="space-y-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-semibold text-foreground">{branchName}</h3>
                    <Badge variant="secondary" className="text-xs">{items.length} {items.length === 1 ? 'item' : 'items'}</Badge>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {items.map(item => renderItemCard(item))}
                  </div>
                </div>
              ));
            })()
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredItems.map(item => renderItemCard(item))}
            </div>
          )}

          {filteredItems.length === 0 && (
            <div className="text-center py-8">
              <p className="text-muted-foreground">No {isPharmacy ? 'medicines' : 'items'} found.</p>
              {branchItems.length === 0 && (
                <p className="text-sm text-muted-foreground mt-2">
                  Click "Add Item" to add items from the catalog to your branch inventory.
                </p>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="stock-history">
          <StockEditHistory />
        </TabsContent>

        <TabsContent value="categories">
          <CategoryManagement />
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <AddBranchItemDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        onItemAdded={handleItemAdded}
      />

      <EditBranchItemDialog
        open={!!editingItem}
        onOpenChange={(open) => { if (!open) setEditingItem(null); }}
        item={editingItem}
        onItemUpdated={handleItemUpdated}
      />

      <ConfirmationDialog
        open={deleteConfirmation.open}
        onOpenChange={(open) => setDeleteConfirmation(prev => ({ ...prev, open }))}
        title={`Remove ${deleteConfirmation.itemName}?`}
        description="This will remove the item from this branch's inventory. The master catalog entry will not be affected."
        onConfirm={confirmDeleteItem}
        confirmText="Remove"
      />

      <BatchBreakdownDialog
        open={batchBreakdown.open}
        onOpenChange={(open) => setBatchBreakdown(prev => ({ ...prev, open }))}
        branchItemId={batchBreakdown.itemId}
        itemName={batchBreakdown.itemName}
      />
    </div>
  );
}
