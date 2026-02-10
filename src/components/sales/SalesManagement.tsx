import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import { Search, Plus, Minus, ShoppingCart, Trash2, CreditCard, Percent, Filter } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useBranchContext } from '@/hooks/useBranchContext';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import AddToCartDialog from './AddToCartDialog';

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
  stripesCount?: number; // Number of stripes when selling by stripe
}

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
  const [selectedMedicine, setSelectedMedicine] = useState<Medicine | null>(null);
  const [showAddToCartDialog, setShowAddToCartDialog] = useState(false);
  const { profile } = useAuth();
  const { toast } = useToast();
  const { selectedBranch } = useBranchContext();
  
  const itemsPerPage = 16;

  useEffect(() => {
    fetchMedicines();
  }, [selectedBranch]);

  useEffect(() => {
    const filtered = medicines.filter(medicine => {
      const matchesSearch = medicine.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        medicine.generic_name?.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesCategory = categoryFilter === 'all' || medicine.category === categoryFilter;
      
      return matchesSearch && matchesCategory;
    });
    setFilteredMedicines(filtered);
    setCurrentPage(1); // Reset to first page when filters change
  }, [medicines, searchTerm, categoryFilter]);

  useEffect(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    setPaginatedMedicines(filteredMedicines.slice(startIndex, endIndex));
  }, [filteredMedicines, currentPage]);

  const fetchMedicines = async () => {
    try {
      // RLS policies handle ownership filtering automatically
      let query = supabase
        .from('medicines')
        .select('id, name, generic_name, selling_price, stock_quantity, category, expiry_date, units_per_pack, open_pack_units, unit_label')
        .gt('stock_quantity', 0)
        .order('name');

      // Filter by specific branch if selected
      if (selectedBranch) {
        query = query.eq('branch_id', selectedBranch);
      }

      const { data, error } = await query;

      if (error) throw error;
      setMedicines(data || []);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to fetch medicines",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
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
    const now = new Date();
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(now.getDate() + 30);
    return expiry <= thirtyDaysFromNow;
  };

  const addToCart = (medicine: Medicine, saleType: 'full_pack' | 'by_stripe' = 'full_pack', stripesCount: number = 1) => {
    // Validation for stripe sales
    if (saleType === 'by_stripe') {
      if (!medicine.units_per_pack) {
        toast({
          title: "Error",
          description: "This item is not configured for unit sales",
          variant: "destructive"
        });
        return;
      }
      
      const totalAvailableStripes = (medicine.stock_quantity * medicine.units_per_pack) + (medicine.open_pack_units || 0);
      const stripesInCart = cart
        .filter(item => item.id === medicine.id && item.saleType === 'by_stripe')
        .reduce((sum, item) => sum + (item.stripesCount || 0), 0);
      
      if (stripesCount > totalAvailableStripes - stripesInCart) {
        toast({
          title: "Error",
          description: "Not enough stripes available",
          variant: "destructive"
        });
        return;
      }
    }
    
    const existingItem = cart.find(item => item.id === medicine.id && item.saleType === saleType);
    
    if (existingItem && saleType === 'full_pack') {
      if (existingItem.quantity >= medicine.stock_quantity) {
        toast({
          title: "Error",
          description: "Cannot add more than available stock",
          variant: "destructive"
        });
        return;
      }
      
      setCart(cart.map(item =>
        item.id === medicine.id && item.saleType === saleType
          ? { ...item, quantity: item.quantity + 1, total: (item.quantity + 1) * item.selling_price }
          : item
      ));
    } else if (existingItem && saleType === 'by_stripe') {
      const newStripesCount = (existingItem.stripesCount || 0) + stripesCount;
      const pricePerStripe = medicine.selling_price / (medicine.units_per_pack || 1);
      setCart(cart.map(item =>
        item.id === medicine.id && item.saleType === saleType
          ? { ...item, stripesCount: newStripesCount, total: newStripesCount * pricePerStripe }
          : item
      ));
    } else {
      const pricePerStripe = saleType === 'by_stripe' && medicine.units_per_pack 
        ? medicine.selling_price / medicine.units_per_pack 
        : medicine.selling_price;
      
      setCart([...cart, {
        ...medicine,
        quantity: saleType === 'full_pack' ? 1 : 0,
        saleType,
        stripesCount: saleType === 'by_stripe' ? stripesCount : undefined,
        total: saleType === 'by_stripe' ? stripesCount * pricePerStripe : medicine.selling_price
      }]);
    }
  };

  const updateCartItemQuantity = (id: string, newQuantity: number) => {
    if (newQuantity === 0) {
      setCart(cart.filter(item => item.id !== id));
      return;
    }

    const medicine = medicines.find(m => m.id === id);
    if (medicine && newQuantity > medicine.stock_quantity) {
      toast({
        title: "Error",
        description: "Cannot add more than available stock",
        variant: "destructive"
      });
      return;
    }

    setCart(cart.map(item =>
      item.id === id
        ? { ...item, quantity: newQuantity, total: newQuantity * item.selling_price }
        : item
    ));
  };

  const removeFromCart = (id: string) => {
    setCart(cart.filter(item => item.id !== id));
  };

  const calculateSubtotal = () => {
    return cart.reduce((sum, item) => sum + item.total, 0);
  };

  const calculateDiscount = () => {
    return (calculateSubtotal() * discountPercent) / 100;
  };

  const calculateTotal = () => {
    return calculateSubtotal() - calculateDiscount();
  };

  const handleCheckout = async () => {
    if (cart.length === 0) {
      toast({
        title: "Error",
        description: "Cart is empty",
        variant: "destructive"
      });
      return;
    }

    setShowCheckoutConfirm(true);
  };

  const confirmCheckout = async () => {
    setShowCheckoutConfirm(false);
    setProcessing(true);

    try {
      // Create sale record
      const { data: saleData, error: saleError } = await supabase
        .from('sales')
        .insert([{
          total_amount: calculateTotal(),
          payment_method: paymentMethod,
          discount_amount: calculateDiscount(),
          sold_by: profile?.id,
          branch_id: selectedBranch || profile?.branch_id
        }])
        .select()
        .single();

      if (saleError) throw saleError;

      // Create sale items
      const saleItems = cart.map(item => ({
        sale_id: saleData.id,
        medicine_id: item.id,
        quantity: item.saleType === 'full_pack' ? item.quantity : 0,
        unit_price: item.selling_price,
        total_price: item.total,
        sale_type: item.saleType,
        stripes_sold: item.saleType === 'by_stripe' ? item.stripesCount : null
      }));

      const { error: itemsError } = await supabase
        .from('sale_items')
        .insert(saleItems);

      if (itemsError) throw itemsError;

      // Update stock quantities
      for (const item of cart) {
        if (item.saleType === 'full_pack') {
          // Deduct full packs
          const { error: stockError } = await supabase
            .from('medicines')
            .update({ 
              stock_quantity: item.stock_quantity - item.quantity 
            })
            .eq('id', item.id);

          if (stockError) throw stockError;
        } else if (item.saleType === 'by_stripe' && item.stripesCount) {
          // Handle stripe deduction
          const medicine = medicines.find(m => m.id === item.id);
          if (!medicine || !medicine.units_per_pack) continue;
          
          let stripesToDeduct = item.stripesCount;
          let newOpenPackStripes = medicine.open_pack_units || 0;
          let newStockQuantity = medicine.stock_quantity;
          
          // First, deduct from open pack
          if (newOpenPackStripes > 0) {
            const deductFromOpen = Math.min(stripesToDeduct, newOpenPackStripes);
            newOpenPackStripes -= deductFromOpen;
            stripesToDeduct -= deductFromOpen;
          }
          
          // If more stripes needed, open new packs
          while (stripesToDeduct > 0 && newStockQuantity > 0) {
            newStockQuantity--;
            newOpenPackStripes = medicine.units_per_pack;
            const deductFromNewPack = Math.min(stripesToDeduct, newOpenPackStripes);
            newOpenPackStripes -= deductFromNewPack;
            stripesToDeduct -= deductFromNewPack;
          }
          
          const { error: stockError } = await supabase
            .from('medicines')
            .update({ 
              stock_quantity: newStockQuantity,
              open_pack_units: newOpenPackStripes
            })
            .eq('id', item.id);

          if (stockError) throw stockError;
        }
      }

      toast({
        title: "Success",
        description: `Sale completed successfully! Payment: ${paymentMethod}. Total: ETB ${calculateTotal().toFixed(2)}`
      });

      setCart([]);
      setPaymentMethod('Cash');
      setDiscountPercent(0);
      fetchMedicines(); // Refresh to get updated stock
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to process sale",
        variant: "destructive"
      });
    } finally {
      setProcessing(false);
    }
  };

  const getUniqueCategories = () => {
    const categories = [...new Set(medicines.map(m => m.category).filter(Boolean))];
    return categories.sort();
  };

  if (loading) {
    return <div>Loading medicines...</div>;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Medicine Selection */}
      <div className="lg:col-span-2 space-y-4">
        <div className="flex items-center space-x-4">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search medicines..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8"
            />
          </div>
          
          <div className="flex items-center space-x-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Filter by category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {getUniqueCategories().map((category) => (
                  <SelectItem key={category} value={category}>
                    {category}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {paginatedMedicines.map((medicine) => (
            <Card key={medicine.id} className="cursor-pointer hover:shadow-md transition-shadow">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">{medicine.name}</CardTitle>
                    {medicine.generic_name && (
                      <CardDescription>{medicine.generic_name}</CardDescription>
                    )}
                  </div>
                  {medicine.category && (
                    <Badge variant="outline">{medicine.category}</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Price:</span>
                    <span className="font-medium">ETB {medicine.selling_price}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Stock:</span>
                    <Badge variant={medicine.stock_quantity <= 10 ? "destructive" : "secondary"}>
                      {medicine.stock_quantity}
                    </Badge>
                  </div>
                  {medicine.expiry_date && (
                    <div className="flex justify-between text-sm">
                      <span>Expires:</span>
                      <div className="flex items-center space-x-1">
                        <span className={
                          isExpired(medicine.expiry_date) 
                            ? 'text-destructive font-medium' 
                            : isExpiringSoon(medicine.expiry_date) 
                              ? 'text-warning' 
                              : ''
                        }>
                          {new Date(medicine.expiry_date).toLocaleDateString()}
                        </span>
                        {isExpired(medicine.expiry_date) && (
                          <Badge variant="destructive" className="text-xs">
                            Expired
                          </Badge>
                        )}
                        {!isExpired(medicine.expiry_date) && isExpiringSoon(medicine.expiry_date) && (
                          <Badge variant="destructive" className="text-xs">
                            Soon
                          </Badge>
                        )}
                      </div>
                    </div>
                  )}
                  <Button 
                    onClick={() => {
                      setSelectedMedicine(medicine);
                      setShowAddToCartDialog(true);
                    }}
                    className="w-full"
                    disabled={medicine.stock_quantity === 0 || isExpired(medicine.expiry_date)}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    {isExpired(medicine.expiry_date) ? 'Expired' : 'Add to Cart'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {filteredMedicines.length === 0 && (
          <div className="text-center py-8">
            <p className="text-muted-foreground">No medicines found.</p>
          </div>
        )}

        {/* Pagination for medicines */}
        {Math.ceil(filteredMedicines.length / itemsPerPage) > 1 && (
          <div className="flex justify-center col-span-full">
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious 
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      if (currentPage > 1) setCurrentPage(currentPage - 1);
                    }}
                    className={currentPage === 1 ? "pointer-events-none opacity-50" : ""}
                  />
                </PaginationItem>
                
                {Array.from({ length: Math.ceil(filteredMedicines.length / itemsPerPage) }, (_, i) => i + 1).map((page) => (
                  <PaginationItem key={page}>
                    <PaginationLink
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        setCurrentPage(page);
                      }}
                      isActive={currentPage === page}
                    >
                      {page}
                    </PaginationLink>
                  </PaginationItem>
                ))}
                
                <PaginationItem>
                  <PaginationNext 
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      if (currentPage < Math.ceil(filteredMedicines.length / itemsPerPage)) setCurrentPage(currentPage + 1);
                    }}
                    className={currentPage === Math.ceil(filteredMedicines.length / itemsPerPage) ? "pointer-events-none opacity-50" : ""}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
        )}

        <div className="text-center text-sm text-muted-foreground col-span-full">
          Showing {paginatedMedicines.length} of {filteredMedicines.length} medicines
        </div>
      </div>

      {/* Cart */}
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <ShoppingCart className="h-5 w-5 mr-2" />
              Shopping Cart
            </CardTitle>
          </CardHeader>
          <CardContent>
            {cart.length === 0 ? (
              <p className="text-muted-foreground text-center py-4">Cart is empty</p>
            ) : (
              <div className="space-y-4">
                {cart.map((item) => (
                  <div key={`${item.id}-${item.saleType}`} className="p-3 border rounded space-y-2">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h4 className="font-medium text-sm">{item.name}</h4>
                        <div className="space-y-1 mt-1">
                          <p className="text-xs text-muted-foreground">
                            Type: <Badge variant="outline" className="text-xs">
                              {item.saleType === 'full_pack' ? 'Full Pack' : 'By Stripe'}
                            </Badge>
                          </p>
                          {item.saleType === 'full_pack' ? (
                            <p className="text-xs text-muted-foreground">
                              ETB {item.selling_price} × {item.quantity} = ETB {item.total.toFixed(2)}
                            </p>
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              {item.stripesCount} {item.unit_label || 'units'} @ ETB {(item.selling_price / (item.units_per_pack || 1)).toFixed(2)} = ETB {item.total.toFixed(2)}
                            </p>
                          )}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => removeFromCart(item.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
                
                <div className="border-t pt-4 space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="payment-method">Payment Method</Label>
                    <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select payment method" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Cash">Cash</SelectItem>
                        <SelectItem value="Commercial Bank of Ethiopia">Commercial Bank of Ethiopia</SelectItem>
                        <SelectItem value="Awash International Bank">Awash International Bank</SelectItem>
                        <SelectItem value="Bank of Abyssinia">Bank of Abyssinia</SelectItem>
                        <SelectItem value="Dashen Bank">Dashen Bank</SelectItem>
                        <SelectItem value="Telebirr">Telebirr</SelectItem>
                        <SelectItem value="M-PESA | Safaricom">M-PESA | Safaricom</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Discount Section */}
                  <div className="space-y-2">
                    <Label htmlFor="discount">Discount (%)</Label>
                    <div className="flex items-center space-x-2">
                      <Percent className="h-4 w-4 text-muted-foreground" />
                      <Input
                        id="discount"
                        type="number"
                        min="0"
                        max="100"
                        value={discountPercent}
                        onChange={(e) => setDiscountPercent(Math.max(0, Math.min(100, Number(e.target.value))))}
                        placeholder="0"
                        className="flex-1"
                      />
                    </div>
                  </div>
                  
                  <Separator />

                  {/* Pricing Summary */}
                  <div className="space-y-2">
                     <div className="flex justify-between text-sm">
                       <span>Subtotal:</span>
                       <span>ETB {calculateSubtotal().toFixed(2)}</span>
                     </div>
                     {discountPercent > 0 && (
                       <div className="flex justify-between text-sm text-success">
                         <span>Discount ({discountPercent}%):</span>
                         <span>-ETB {calculateDiscount().toFixed(2)}</span>
                       </div>
                     )}
                   </div>
                   
                   <Separator />
                   
                   <div className="flex justify-between font-medium">
                     <span>Total:</span>
                     <span>ETB {calculateTotal().toFixed(2)}</span>
                   </div>
                  
                  <Button 
                    onClick={handleCheckout}
                    className="w-full"
                    disabled={processing}
                  >
                    <CreditCard className="h-4 w-4 mr-2" />
                    {processing ? "Processing..." : `Checkout (${paymentMethod})`}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
        
        <ConfirmationDialog
          open={showCheckoutConfirm}
          onOpenChange={setShowCheckoutConfirm}
          title="Confirm Checkout"
          description={`Are you sure you want to complete this sale? Total: ETB ${calculateTotal().toFixed(2)} via ${paymentMethod}`}
          onConfirm={confirmCheckout}
          confirmText="Complete Sale"
        />
        
        <AddToCartDialog
          open={showAddToCartDialog}
          onOpenChange={setShowAddToCartDialog}
          medicine={selectedMedicine}
          onAddToCart={addToCart}
        />
      </div>
    </div>
  );
}