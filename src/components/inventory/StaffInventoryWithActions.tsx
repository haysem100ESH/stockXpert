import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import { Search, Edit2, Plus, Trash2, Filter, Settings2, SlidersHorizontal, History, Layers, PackagePlus, Upload } from 'lucide-react';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useBranchContext } from '@/hooks/useBranchContext';
import { useReadOnly } from '@/hooks/useReadOnly';
import { useBranchInventory } from '@/hooks/useBranchInventory';
import AddBranchItemDialog from './AddBranchItemDialog';
import EditBranchItemDialog, { type BranchItem } from './EditBranchItemDialog';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import CategoryManagement from './CategoryManagement';
import StockEditHistory from './StockEditHistory';
import BatchBreakdownDialog from './BatchBreakdownDialog';
import StockAdjustmentDialog from './StockAdjustmentDialog';
import ImportCsvDialog from './ImportCsvDialog';
import { formatMedicineName, formatPackaging } from '@/lib/medicineDisplay';

const ITEMS_PER_PAGE = 24;

export default function StaffInventoryWithActions() {
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'inventory';
  const [activeTab, setActiveTab] = useState(initialTab);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [groupFilter, setGroupFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [editingItem, setEditingItem] = useState<BranchItem | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState<{
    open: boolean;
    itemId: string;
    itemName: string;
  }>({ open: false, itemId: '', itemName: '' });
  const [hasBranches, setHasBranches] = useState(true);
  const [batchBreakdown, setBatchBreakdown] = useState<{ open: boolean; itemId: string; itemName: string }>({ open: false, itemId: '', itemName: '' });
  const [adjustingItem, setAdjustingItem] = useState<BranchItem | null>(null);
  const { toast } = useToast();
  const { profile } = useAuth();
  const { selectedBranch, branchType } = useBranchContext();
  const readOnly = useReadOnly();
  const isPharmacy = branchType === 'pharmacy';

  // Cache-first fetch via TanStack Query — instant hydration on revisit.
  const { items: branchItems, loading, refetch, removeItemFromCache } = useBranchInventory();

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab) setActiveTab(tab);
  }, [searchParams]);

  useEffect(() => {
    if (profile) checkBranches();
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

  // Derive filtered list with useMemo (no extra state, no effect-thrash).
  const filteredItems = useMemo(() => {
    const medicineCategories = ['tablet', 'capsule', 'syrup', 'injection', 'cream', 'ointment', 'drops', 'inhaler'];
    const term = searchTerm.toLowerCase();
    return branchItems.filter((item: any) => {
      const matchesSearch = item.name.toLowerCase().includes(term) ||
        (item.generic_name || '').toLowerCase().includes(term) ||
        (item.strength || '').toLowerCase().includes(term) ||
        (item.medicine_group || '').toLowerCase().includes(term);
      let matchesCategory = true;
      if (categoryFilter === 'medicines_only') {
        matchesCategory = medicineCategories.includes(item.category);
      } else if (categoryFilter !== 'all') {
        matchesCategory = item.category === categoryFilter;
      }
      const matchesGroup = groupFilter === 'all' || (item.medicine_group || '') === groupFilter;
      return matchesSearch && matchesCategory && matchesGroup;
    });
  }, [branchItems, searchTerm, categoryFilter, groupFilter]);

  // Reset to page 1 whenever filters change.
  useEffect(() => { setCurrentPage(1); }, [searchTerm, categoryFilter, selectedBranch]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / ITEMS_PER_PAGE));
  const paginatedItems = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredItems.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredItems, currentPage]);

  const handleItemAdded = () => {
    refetch();
    setShowAddDialog(false);
  };

  const handleEditItem = (item: BranchItem) => {
    setEditingItem(item);
  };

  const handleItemUpdated = () => {
    refetch();
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
      // Optimistically remove from cache so UI updates instantly.
      removeItemFromCache(itemId);
      toast({ title: 'Success', description: `${isPharmacy ? 'Medicine' : 'Item'} removed from branch` });
      setDeleteConfirmation({ open: false, itemId: '', itemName: '' });
    } catch (error) {
      toast({ title: 'Error', description: `Failed to delete ${isPharmacy ? 'medicine' : 'item'}. It may have related records.`, variant: 'destructive' });
    }
  };

  const isOutOfStock = (item: BranchItem) => item.quantity === 0;
  const isLowStock = (item: BranchItem) => item.quantity > 0 && item.quantity <= 10;
  const getUniqueCategories = () => [...new Set(branchItems.map(i => i.category))].sort();
  const getUniqueGroups = () => [...new Set(branchItems.map((i: any) => i.medicine_group).filter(Boolean))].sort() as string[];

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

  const renderItemCard = (item: BranchItem & { branch_name?: string; medicine_group?: string | null; strength?: string | null }) => (
    <Card key={item.id} className={isExpired(item) ? 'border-destructive/30 bg-destructive/5' : ''}>
      <CardHeader>
        <div className="flex justify-between items-start">
          <div className="flex-1">
            <CardTitle className="text-lg">{isPharmacy ? formatMedicineName(item.name, item.strength) : item.name}</CardTitle>
            {item.generic_name && <CardDescription>{item.generic_name}</CardDescription>}
          </div>
          <div className="flex space-x-1">
            <Button size="sm" variant="ghost" onClick={() => setBatchBreakdown({ open: true, itemId: item.id, itemName: item.name })} title="View Batches"><Layers className="h-4 w-4" /></Button>
            {!readOnly && <Button size="sm" variant="ghost" onClick={() => setAdjustingItem(item)} title="Adjust Stock"><PackagePlus className="h-4 w-4" /></Button>}
            {!readOnly && <Button size="sm" variant="ghost" onClick={() => handleEditItem(item)} title="Edit"><Edit2 className="h-4 w-4" /></Button>}
            {!readOnly && <Button size="sm" variant="ghost" onClick={() => handleDeleteItem(item.id, item.name)} title="Remove"><Trash2 className="h-4 w-4" /></Button>}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <div className="flex justify-between text-sm"><span>Category:</span><Badge variant="outline">{item.category}</Badge></div>
          {isPharmacy && item.medicine_group && <div className="flex justify-between text-sm"><span>Group:</span><Badge variant="secondary" className="text-xs">{item.medicine_group}</Badge></div>}
          {isPharmacy && formatPackaging(item.strips_per_pack, item.units_per_strip, item.units_per_pack) && <div className="flex justify-between text-sm"><span>Packaging:</span><span className="font-mono text-xs">{formatPackaging(item.strips_per_pack, item.units_per_strip, item.units_per_pack)}</span></div>}
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
            <Button onClick={() => setShowImportDialog(true)} disabled={!hasBranches || readOnly} size="sm" variant="outline">
              <Upload className="h-4 w-4 mr-2" />
              Import CSV
            </Button>
            <Button onClick={() => setShowAddDialog(true)} disabled={!hasBranches || readOnly} size="sm">
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

          {/* Group by branch when "All Branches" — operates on the paginated slice */}
          {!selectedBranch && branchItems.some((i: any) => i.branch_name) ? (
            (() => {
              const grouped: Record<string, (BranchItem & { branch_name?: string })[]> = {};
              paginatedItems.forEach((i: any) => {
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
              {paginatedItems.map(item => renderItemCard(item))}
            </div>
          )}

          {/* Pagination controls */}
          {totalPages > 1 && (
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    className={currentPage === 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                  />
                </PaginationItem>
                <PaginationItem>
                  <PaginationLink isActive>
                    {currentPage} / {totalPages}
                  </PaginationLink>
                </PaginationItem>
                <PaginationItem>
                  <PaginationNext
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    className={currentPage === totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
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

      <ImportCsvDialog
        open={showImportDialog}
        onOpenChange={setShowImportDialog}
        onImported={() => { refetch(); setShowImportDialog(false); }}
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

      <StockAdjustmentDialog
        open={!!adjustingItem}
        onOpenChange={(open) => { if (!open) setAdjustingItem(null); }}
        medicine={adjustingItem ? {
          id: adjustingItem.id,
          medicine_id: (adjustingItem as any).medicine_id,
          name: adjustingItem.name,
          stock_quantity: adjustingItem.quantity,
          purchase_price: adjustingItem.purchase_price,
          selling_price: (adjustingItem as any).selling_price,
          branch_id: adjustingItem.branch_id,
          item_type: (adjustingItem as any).item_type,
          unit_label: (adjustingItem as any).unit_label,
        } : null}
        onAdjusted={() => { setAdjustingItem(null); refetch(); }}
      />
    </div>
  );
}
