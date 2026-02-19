import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import { Search, Plus, ShoppingCart, Filter } from 'lucide-react';
import { supabase } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useBranchContext } from '@/hooks/useBranchContext';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import CartSlider from './CartSlider';
import { useIsMobile } from '@/hooks/use-mobile';

interface Medicine {
  id: string;
  name: string;
  generic_name?: string;
  selling_price: number;
  stock_quantity: number;
  category?: string;
  expiry_date?: string;
  units_per_pack?: number;
  open_pack_units?: number;
  unit_label?: string;
}

interface CartItem extends Medicine {
  quantity: number;
  total: number;
  saleType: 'full_pack' | 'by_stripe';
  stripesCount?: number;
}

type ChangeAction = 'keep_profit' | 'deduct_debt' | 'give_change' | null;

export default function SalesManagement() {
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [filteredMedicines, setFilteredMedicines] = useState<Medicine[]>([]);
  const [paginatedMedicines, setPaginatedMedicines] = useState<Medicine[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<string>('Cash');
  const [discountPercent, setDiscountPercent] = useState<number>(0);
  const [showCheckoutConfirm, setShowCheckoutConfirm] = useState(false);
  const [customers, setCustomers] = useState<{id: string; name: string; phone?: string | null; current_debt?: number}[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('none');
  const [amountReceived, setAmountReceived] = useState<string>('');
  const [changeAction, setChangeAction] = useState<ChangeAction>(null);
  const [keepChangeOption, setKeepChangeOption] = useState<'profit' | 'deduct_debt'>('profit');
  const [cartOpen, setCartOpen] = useState(false);

  const { profile } = useAuth();
  const { toast } = useToast();
  const { selectedBranch, branchType } = useBranchContext();
  const isMobile = useIsMobile();
  const isPharmacy = branchType === 'pharmacy';

  const itemsPerPage = 16;

  useEffect(() => { fetchMedicines(); fetchCustomers(); }, [selectedBranch]);

  useEffect(() => {
    const filtered = medicines.filter(medicine => {
      const matchesSearch = medicine.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        medicine.generic_name?.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCategory = categoryFilter === 'all' || medicine.category === categoryFilter;
      return matchesSearch && matchesCategory;
    });
    setFilteredMedicines(filtered);
    setCurrentPage(1);
  }, [medicines, searchTerm, categoryFilter]);

  useEffect(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    setPaginatedMedicines(filteredMedicines.slice(startIndex, startIndex + itemsPerPage));
  }, [filteredMedicines, currentPage]);

  // Clear amount received when cart changes so placeholder takes effect
  useEffect(() => {
    setAmountReceived('');
  }, [cart, discountPercent]);

  // Reset change action when amount received changes
  useEffect(() => {
    setChangeAction(null);
    setKeepChangeOption('profit');
  }, [amountReceived]);

  const fetchMedicines = async () => {
    try {
      let query = (supabase as any)
        .from('medicines')
        .select('id, name, generic_name, selling_price, stock_quantity, category, expiry_date, units_per_pack, open_pack_units, unit_label')
        .gt('stock_quantity', 0)
        .order('name');
      if (selectedBranch) query = query.eq('branch_id', selectedBranch);
      const { data, error } = await query;
      if (error) throw error;
      setMedicines(data || []);
    } catch {
      toast({ title: 'Error', description: `Failed to fetch ${isPharmacy ? 'medicines' : 'items'}`, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const fetchCustomers = async () => {
    try {
      // Note: customers table does not have branch_id column yet — fetch all and filter by owner's branches
      const { data, error } = await (supabase as any)
        .from('customers')
        .select('id, name, phone, current_debt')
        .order('name');
      if (error) {
        console.warn('[Customers] fetch warning:', error.message);
        setCustomers([]);
        return;
      }
      setCustomers(data || []);
    } catch (error) {
      console.error('Error fetching customers:', error);
    }
  };

  const isExpired = (expiryDate?: string) => {
    if (!expiryDate) return false;
    const expiry = new Date(expiryDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    expiry.setHours(0, 0, 0, 0);
    return expiry <= today;
  };

  const isExpiringSoon = (expiryDate?: string) => {
    if (!expiryDate) return false;
    if (isExpired(expiryDate)) return false;
    const expiry = new Date(expiryDate);
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
    return expiry <= thirtyDaysFromNow;
  };

  // Instant add — no dialog, defaults to strip if available
  const addToCartInstant = (medicine: Medicine) => {
    const defaultSaleType: 'full_pack' | 'by_stripe' = medicine.units_per_pack ? 'by_stripe' : 'full_pack';
    addToCart(medicine, defaultSaleType, 1);
    if (isMobile) setCartOpen(true);
  };

  const addToCart = (medicine: Medicine, saleType: 'full_pack' | 'by_stripe', count: number) => {
    if (saleType === 'by_stripe') {
      if (!medicine.units_per_pack) {
        toast({ title: 'Error', description: 'This item is not configured for unit sales', variant: 'destructive' });
        return;
      }
      const totalAvailableStripes = (medicine.stock_quantity * medicine.units_per_pack) + (medicine.open_pack_units || 0);
      const stripesInCart = cart
        .filter(item => item.id === medicine.id && item.saleType === 'by_stripe')
        .reduce((sum, item) => sum + (item.stripesCount || 0), 0);
      if (count > totalAvailableStripes - stripesInCart) {
        toast({ title: 'Error', description: 'Not enough units available', variant: 'destructive' });
        return;
      }
    }

    const existingItem = cart.find(item => item.id === medicine.id && item.saleType === saleType);

    if (existingItem && saleType === 'full_pack') {
      const newQty = existingItem.quantity + count;
      if (newQty > medicine.stock_quantity) {
        toast({ title: 'Error', description: 'Cannot add more than available stock', variant: 'destructive' });
        return;
      }
      setCart(prev => prev.map(item =>
        item.id === medicine.id && item.saleType === saleType
          ? { ...item, quantity: newQty, total: newQty * item.selling_price }
          : item
      ));
    } else if (existingItem && saleType === 'by_stripe') {
      const newCount = (existingItem.stripesCount || 0) + count;
      const pricePerStripe = medicine.selling_price / (medicine.units_per_pack || 1);
      setCart(prev => prev.map(item =>
        item.id === medicine.id && item.saleType === saleType
          ? { ...item, stripesCount: newCount, total: newCount * pricePerStripe }
          : item
      ));
    } else {
      const pricePerStripe = saleType === 'by_stripe' && medicine.units_per_pack
        ? medicine.selling_price / medicine.units_per_pack
        : medicine.selling_price;
      setCart(prev => [...prev, {
        ...medicine,
        quantity: saleType === 'full_pack' ? count : 0,
        saleType,
        stripesCount: saleType === 'by_stripe' ? count : undefined,
        total: saleType === 'by_stripe' ? count * pricePerStripe : count * medicine.selling_price,
      }]);
    }
  };

  const removeFromCart = (id: string, saleType: 'full_pack' | 'by_stripe') => {
    setCart(prev => prev.filter(item => !(item.id === id && item.saleType === saleType)));
  };

  const updateCartQuantity = (id: string, saleType: 'full_pack' | 'by_stripe', delta: number) => {
    setCart(prev => prev.map(item => {
      if (item.id !== id || item.saleType !== saleType) return item;
      if (saleType === 'full_pack') {
        const newQty = Math.max(1, item.quantity + delta);
        if (newQty > item.stock_quantity) return item;
        return { ...item, quantity: newQty, total: newQty * item.selling_price };
      } else {
        const pricePerStripe = item.selling_price / (item.units_per_pack || 1);
        const totalAvailableStripes = (item.stock_quantity * (item.units_per_pack || 1)) + (item.open_pack_units || 0);
        const newCount = Math.max(1, (item.stripesCount || 1) + delta);
        if (newCount > totalAvailableStripes) return item;
        return { ...item, stripesCount: newCount, total: newCount * pricePerStripe };
      }
    }));
  };

  const changeSaleType = (id: string, newSaleType: 'full_pack' | 'by_stripe') => {
    setCart(prev => prev.map(item => {
      if (item.id !== id) return item;
      if (newSaleType === 'by_stripe' && item.units_per_pack) {
        const pricePerStripe = item.selling_price / item.units_per_pack;
        return { ...item, saleType: 'by_stripe', stripesCount: 1, quantity: 0, total: pricePerStripe };
      } else {
        return { ...item, saleType: 'full_pack', stripesCount: undefined, quantity: 1, total: item.selling_price };
      }
    }));
  };

  const calculateSubtotal = () => cart.reduce((sum, item) => sum + item.total, 0);
  const calculateDiscount = () => (calculateSubtotal() * discountPercent) / 100;
  const calculateTotal = () => calculateSubtotal() - calculateDiscount();

  const getChangeAmount = () => {
    const total = calculateTotal();
    const received = amountReceived ? parseFloat(amountReceived) : total;
    return received - total;
  };

  const selectedCustomer = customers.find(c => c.id === selectedCustomerId);
  const customerHasDebt = selectedCustomer && (selectedCustomer.current_debt || 0) > 0;

  const handleCheckout = () => {
    if (cart.length === 0) {
      toast({ title: 'Error', description: 'Cart is empty', variant: 'destructive' });
      return;
    }
    const change = getChangeAmount();
    if (change > 0.001 && !changeAction) {
      toast({ title: 'Action Required', description: 'Please select Keep Change or Give Change before checkout', variant: 'destructive' });
      return;
    }
    setShowCheckoutConfirm(true);
  };

  const confirmCheckout = async () => {
    setShowCheckoutConfirm(false);
    setProcessing(true);
    try {
      const total = calculateTotal();
      const received = parseFloat(amountReceived) || total;
      const change = Math.max(0, received - total);

      let actualPaid = total;
      let extraProfit = 0;
      let finalChangeAction: string | null = null;

      if (change > 0.001) {
        if (changeAction === 'give_change') {
          actualPaid = total;
          extraProfit = 0;
          finalChangeAction = 'give_change';
        } else if (changeAction === 'keep_profit') {
          if (keepChangeOption === 'deduct_debt' && customerHasDebt) {
            actualPaid = total;
            extraProfit = 0;
            finalChangeAction = 'deduct_debt';
          } else {
            actualPaid = received;
            extraProfit = change;
            finalChangeAction = 'keep_profit';
          }
        }
      } else {
        actualPaid = Math.min(received, total);
      }

      const paymentStatus = actualPaid >= total ? 'paid' : actualPaid > 0 ? 'partial' : 'unpaid';

      // Build the base sale insert payload — only columns confirmed to exist in the DB
      const baseSaleInsert: Record<string, unknown> = {
        total_amount: Number(total.toFixed(2)),
        payment_method: String(paymentMethod),
        discount_amount: Number(calculateDiscount().toFixed(2)),
        sold_by: profile?.id ?? null,
        branch_id: selectedBranch ?? profile?.branch_id ?? null,
        amount_paid: Number(actualPaid.toFixed(2)),
        payment_status: String(paymentStatus),
      };

      // Only add customer_id if a customer is selected
      if (selectedCustomerId !== 'none') {
        baseSaleInsert.customer_id = selectedCustomerId;
      }

      console.log('[Sale Payload]', baseSaleInsert);

      // Try with extended columns first; fall back to base if schema doesn't have them
      let saleData: any = null;
      const extendedInsert = { ...baseSaleInsert };
      if (finalChangeAction) extendedInsert.change_action = String(finalChangeAction);
      if (extraProfit > 0) extendedInsert.extra_profit = Number(extraProfit.toFixed(2));

      let saleResult = await (supabase as any)
        .from('sales')
        .insert([extendedInsert])
        .select()
        .single();

      // If extended columns don't exist in schema, retry with base payload
      if (saleResult.error?.code === '42703' || saleResult.error?.message?.includes('does not exist')) {
        console.warn('[Sale Insert] Falling back to base payload (extended columns not in schema)');
        saleResult = await (supabase as any)
          .from('sales')
          .insert([baseSaleInsert])
          .select()
          .single();
      }

      if (saleResult.error) {
        console.error('[Sale Insert Error]', saleResult.error);
        throw saleResult.error;
      }
      saleData = saleResult.data;

      const saleItems = cart.map(item => ({
        sale_id: saleData.id,
        medicine_id: item.id,
        quantity: item.saleType === 'full_pack' ? Number(item.quantity) : 0,
        unit_price: Number(item.selling_price),
        total_price: Number(item.total.toFixed(2)),
        sale_type: item.saleType,
        stripes_sold: item.saleType === 'by_stripe' ? Number(item.stripesCount) : null,
      }));

      const { error: itemsError } = await (supabase as any).from('sale_items').insert(saleItems);
      if (itemsError) {
        console.error('[Sale Items Error]', itemsError);
        throw itemsError;
      }

      // Stock deduction
      for (const item of cart) {
        if (item.saleType === 'full_pack') {
          await (supabase as any)
            .from('medicines')
            .update({ stock_quantity: item.stock_quantity - item.quantity })
            .eq('id', item.id);
        } else if (item.saleType === 'by_stripe' && item.stripesCount) {
          const medicine = medicines.find(m => m.id === item.id);
          if (!medicine?.units_per_pack) continue;
          let stripesToDeduct = item.stripesCount;
          let newOpenPackStripes = medicine.open_pack_units || 0;
          let newStockQuantity = medicine.stock_quantity;
          if (newOpenPackStripes > 0) {
            const deductFromOpen = Math.min(stripesToDeduct, newOpenPackStripes);
            newOpenPackStripes -= deductFromOpen;
            stripesToDeduct -= deductFromOpen;
          }
          while (stripesToDeduct > 0 && newStockQuantity > 0) {
            newStockQuantity--;
            const deductFromNewPack = Math.min(stripesToDeduct, medicine.units_per_pack);
            newOpenPackStripes = medicine.units_per_pack - deductFromNewPack;
            stripesToDeduct -= deductFromNewPack;
          }
          await (supabase as any)
            .from('medicines')
            .update({ stock_quantity: newStockQuantity, open_pack_units: newOpenPackStripes })
            .eq('id', item.id);
        }
      }

      // Handle debt deduction
      if (finalChangeAction === 'deduct_debt' && customerHasDebt && selectedCustomer) {
        const deductAmount = Math.min(change, selectedCustomer.current_debt || 0);
        await (supabase as any)
          .from('customers')
          .update({ current_debt: (selectedCustomer.current_debt || 0) - deductAmount })
          .eq('id', selectedCustomer.id);
      }

      let successMessage = `Sale completed! Total: ETB ${total.toFixed(2)} via ${paymentMethod}.`;
      if (extraProfit > 0) successMessage += ` Extra profit: ETB ${extraProfit.toFixed(2)}.`;
      if (finalChangeAction === 'give_change') successMessage += ` Change given: ETB ${change.toFixed(2)}.`;
      if (finalChangeAction === 'deduct_debt') successMessage += ` ETB ${change.toFixed(2)} deducted from customer debt.`;

      toast({ title: 'Success', description: successMessage });

      // Reset state
      setCart([]);
      setPaymentMethod('Cash');
      setDiscountPercent(0);
      setSelectedCustomerId('none');
      setAmountReceived('');
      setChangeAction(null);
      setKeepChangeOption('profit');
      setCartOpen(false);
      fetchMedicines();
      fetchCustomers();
    } catch (error: any) {
      console.error('[Checkout Error]', error);
      toast({
        title: 'Payment Failed',
        description: 'Unable to process payment. Please check payment details.',
        variant: 'destructive',
      });
    } finally {
      setProcessing(false);
    }
  };

  const getUniqueCategories = () => [...new Set(medicines.map(m => m.category).filter(Boolean))].sort() as string[];

  const subtotal = calculateSubtotal();
  const discount = calculateDiscount();
  const total = calculateTotal();

  if (loading) {
    return <div className="p-4 text-muted-foreground">Loading {isPharmacy ? 'medicines' : 'items'}...</div>;
  }

  return (
    <div className="flex flex-col lg:grid lg:grid-cols-3 gap-6 relative">
      {/* Medicine/Item list */}
      <div className="lg:col-span-2 space-y-4">
        {/* Search + Filter row */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={isPharmacy ? 'Search medicines...' : 'Search items...'}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground shrink-0" />
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-40 md:w-48">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {getUniqueCategories().map((cat) => (
                  <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Mobile cart FAB */}
          {isMobile && (
            <Button
              variant="default"
              size="icon"
              className="relative shrink-0"
              onClick={() => setCartOpen(true)}
            >
              <ShoppingCart className="h-5 w-5" />
              {cart.length > 0 && (
                <span className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground text-xs rounded-full h-5 w-5 flex items-center justify-center font-bold">
                  {cart.length}
                </span>
              )}
            </Button>
          )}
        </div>

        {/* Item grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {paginatedMedicines.map((medicine) => (
            <Card key={medicine.id} className="cursor-pointer hover:shadow-md transition-shadow">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-base">{medicine.name}</CardTitle>
                    {medicine.generic_name && <CardDescription>{medicine.generic_name}</CardDescription>}
                  </div>
                  <div className="flex flex-col gap-1 items-end">
                    {medicine.category && <Badge variant="outline" className="text-xs">{medicine.category}</Badge>}
                    {medicine.units_per_pack && (
                      <Badge variant="secondary" className="text-xs">
                        By {medicine.unit_label || 'unit'}
                      </Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Price:</span>
                    <span className="font-medium">ETB {medicine.selling_price}</span>
                  </div>
                  {medicine.units_per_pack && (
                    <div className="flex justify-between text-sm text-muted-foreground">
                      <span>Per {medicine.unit_label || 'unit'}:</span>
                      <span>ETB {(medicine.selling_price / medicine.units_per_pack).toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm">
                    <span>Stock:</span>
                    <Badge variant={medicine.stock_quantity <= 10 ? 'destructive' : 'secondary'}>
                      {medicine.stock_quantity}
                    </Badge>
                  </div>
                  {isPharmacy && medicine.expiry_date && (
                    <div className="flex justify-between text-sm">
                      <span>Expires:</span>
                      <div className="flex items-center gap-1">
                        <span className={isExpired(medicine.expiry_date) ? 'text-destructive font-medium' : isExpiringSoon(medicine.expiry_date) ? 'text-warning' : ''}>
                          {new Date(medicine.expiry_date).toLocaleDateString()}
                        </span>
                        {isExpired(medicine.expiry_date) && <Badge variant="destructive" className="text-xs">Expired</Badge>}
                        {!isExpired(medicine.expiry_date) && isExpiringSoon(medicine.expiry_date) && <Badge variant="destructive" className="text-xs">Soon</Badge>}
                      </div>
                    </div>
                  )}
                  <Button
                    onClick={() => addToCartInstant(medicine)}
                    className="w-full"
                    disabled={medicine.stock_quantity === 0 || (isPharmacy && isExpired(medicine.expiry_date))}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    {isPharmacy && isExpired(medicine.expiry_date) ? 'Expired' : 'Add to Cart'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {filteredMedicines.length === 0 && (
          <div className="text-center py-8">
            <p className="text-muted-foreground">No {isPharmacy ? 'medicines' : 'items'} found.</p>
          </div>
        )}

        {Math.ceil(filteredMedicines.length / itemsPerPage) > 1 && (
          <div className="flex justify-center">
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    href="#"
                    onClick={(e) => { e.preventDefault(); if (currentPage > 1) setCurrentPage(p => p - 1); }}
                    className={currentPage === 1 ? 'pointer-events-none opacity-50' : ''}
                  />
                </PaginationItem>
                {Array.from({ length: Math.ceil(filteredMedicines.length / itemsPerPage) }, (_, i) => i + 1).map((page) => (
                  <PaginationItem key={page}>
                    <PaginationLink href="#" onClick={(e) => { e.preventDefault(); setCurrentPage(page); }} isActive={currentPage === page}>
                      {page}
                    </PaginationLink>
                  </PaginationItem>
                ))}
                <PaginationItem>
                  <PaginationNext
                    href="#"
                    onClick={(e) => { e.preventDefault(); if (currentPage < Math.ceil(filteredMedicines.length / itemsPerPage)) setCurrentPage(p => p + 1); }}
                    className={currentPage === Math.ceil(filteredMedicines.length / itemsPerPage) ? 'pointer-events-none opacity-50' : ''}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
        )}

        <div className="text-center text-sm text-muted-foreground">
          Showing {paginatedMedicines.length} of {filteredMedicines.length} {isPharmacy ? 'medicines' : 'items'}
        </div>
      </div>

      {/* Cart — desktop sidebar / mobile slider */}
      <CartSlider
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        cart={cart}
        onRemove={removeFromCart}
        onUpdateQuantity={updateCartQuantity}
        onChangeSaleType={changeSaleType}
        customers={customers}
        selectedCustomerId={selectedCustomerId}
        onSelectCustomer={setSelectedCustomerId}
        paymentMethod={paymentMethod}
        onPaymentMethodChange={setPaymentMethod}
        discountPercent={discountPercent}
        onDiscountChange={setDiscountPercent}
        amountReceived={amountReceived}
        onAmountReceivedChange={setAmountReceived}
        changeAction={changeAction}
        onChangeAction={setChangeAction}
        keepChangeOption={keepChangeOption}
        onKeepChangeOption={setKeepChangeOption}
        subtotal={subtotal}
        discount={discount}
        total={total}
        processing={processing}
        onCheckout={handleCheckout}
      />

      <ConfirmationDialog
        open={showCheckoutConfirm}
        onOpenChange={setShowCheckoutConfirm}
        title="Confirm Checkout"
        description={`Complete sale? Total: ETB ${total.toFixed(2)} via ${paymentMethod}`}
        onConfirm={confirmCheckout}
        confirmText="Complete Sale"
      />
    </div>
  );
}
