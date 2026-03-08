import { useRef, useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ShoppingCart, Trash2, CreditCard, Percent, ArrowLeftRight, Wallet, X, Plus, Minus, Search, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import CreditScoreBadge from '@/components/customers/CreditScoreBadge';
import DebtProgressBar from '@/components/customers/DebtProgressBar';

// Free-form measurable quantity input with validation
function MeasurableQtyInput({ value, max, unit, onChange }: { value: number; max: number; unit: string; onChange: (qty: number) => void }) {
  const [inputVal, setInputVal] = useState(String(value));
  const [error, setError] = useState('');

  useEffect(() => {
    setInputVal(String(value));
  }, [value]);

  const validate = (raw: string) => {
    const num = parseFloat(raw);
    if (raw.trim() === '' || isNaN(num)) return 'Enter a valid number';
    if (num <= 0) return 'Must be greater than 0';
    if (num > max) return `Exceeds stock (${max} ${unit})`;
    return '';
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setInputVal(raw);
    const err = validate(raw);
    setError(err);
    if (!err) {
      onChange(parseFloat(parseFloat(raw).toFixed(2)));
    }
  };

  const handleBlur = () => {
    const num = parseFloat(inputVal);
    if (isNaN(num) || num <= 0) {
      setInputVal(String(value));
      setError('');
    } else if (num > max) {
      const clamped = max;
      setInputVal(String(clamped));
      setError('');
      onChange(clamped);
    }
  };

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1">
        <input
          type="number"
          step="any"
          value={inputVal}
          onChange={handleChange}
          onBlur={handleBlur}
          className={cn(
            "w-20 text-sm font-medium text-center border rounded-md h-7 bg-background px-1 focus:outline-none focus:ring-1 focus:ring-ring",
            error && "border-destructive focus:ring-destructive"
          )}
        />
        <span className="text-xs text-muted-foreground">{unit}</span>
      </div>
      {error && <span className="text-[10px] text-destructive leading-tight">{error}</span>}
    </div>
  );
}

interface CartItem {
  id: string;
  name: string;
  selling_price: number;
  stock_quantity: number;
  units_per_pack?: number;
  open_pack_units?: number;
  unit_label?: string;
  item_type?: string;
  quantity: number;
  total: number;
  saleType: 'full_pack' | 'by_stripe';
  stripesCount?: number;
}

interface Customer {
  id: string;
  name: string;
  phone?: string | null;
  computed_debt?: number;
  credit_score?: number;
  max_credit_limit?: number;
}

type ChangeAction = 'keep_profit' | 'deduct_debt' | 'give_change' | null;

interface CartSliderProps {
  open: boolean;
  onClose: () => void;
  cart: CartItem[];
  onRemove: (id: string, saleType: 'full_pack' | 'by_stripe') => void;
  onUpdateQuantity: (id: string, saleType: 'full_pack' | 'by_stripe', delta: number) => void;
  onChangeSaleType: (id: string, newSaleType: 'full_pack' | 'by_stripe') => void;
  onSetMeasurableQuantity?: (id: string, quantity: number) => void;
  customers: Customer[];
  selectedCustomerId: string;
  onSelectCustomer: (id: string) => void;
  paymentMethod: string;
  onPaymentMethodChange: (v: string) => void;
  discountPercent: number;
  onDiscountChange: (v: number) => void;
  amountReceived: string;
  onAmountReceivedChange: (v: string) => void;
  changeAction: ChangeAction;
  onChangeAction: (a: ChangeAction) => void;
  keepChangeOption: 'profit' | 'deduct_debt';
  onKeepChangeOption: (v: 'profit' | 'deduct_debt') => void;
  subtotal: number;
  discount: number;
  total: number;
  processing: boolean;
  onCheckout: () => void;
  creditCheck?: { allowed: boolean; reason?: string; score?: number } | null;
}

export default function CartSlider({
  open, onClose,
  cart, onRemove, onUpdateQuantity, onChangeSaleType, onSetMeasurableQuantity,
  customers, selectedCustomerId, onSelectCustomer,
  paymentMethod, onPaymentMethodChange,
  discountPercent, onDiscountChange,
  amountReceived, onAmountReceivedChange,
  changeAction, onChangeAction,
  keepChangeOption, onKeepChangeOption,
  subtotal, discount, total,
  processing, onCheckout,
  creditCheck,
}: CartSliderProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [customerSearch, setCustomerSearch] = useState('');

  // Close on overlay click
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose();
  };

  const receivedAmount = amountReceived ? parseFloat(amountReceived) : total;
  const changeAmount = receivedAmount - total;
  const hasChange = changeAmount > 0.001;
  const hasShortfall = amountReceived !== '' && receivedAmount < total;

  const selectedCustomer = customers.find(c => c.id === selectedCustomerId);
  const customerHasDebt = selectedCustomer && (selectedCustomer.computed_debt || 0) > 0;

  const filteredCustomers = customers.filter(c => {
    if (!customerSearch.trim()) return true;
    const q = customerSearch.toLowerCase();
    return c.name.toLowerCase().includes(q) || (c.phone || '').toLowerCase().includes(q);
  });

  return (
    <>
      {/* Backdrop — below 1024px */}
      <div
        ref={overlayRef}
        onClick={handleOverlayClick}
        className={cn(
          'fixed inset-0 z-40 bg-black/50 transition-opacity duration-300 lg:hidden',
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        )}
      />

      {/* Slider panel */}
      <div
        className={cn(
          // Mobile: fixed right-side drawer
          'fixed top-0 right-0 h-full z-50 w-[90vw] max-w-sm bg-background shadow-2xl flex flex-col',
          'transition-transform duration-300 ease-in-out',
          'lg:relative lg:top-auto lg:right-auto lg:h-auto lg:z-auto lg:w-auto lg:max-w-none lg:shadow-none',
          'lg:translate-x-0', // always visible on desktop
          open ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b bg-card lg:hidden">
          <div className="flex items-center gap-2 font-semibold">
            <ShoppingCart className="h-5 w-5" />
            Shopping Cart
            {cart.length > 0 && (
              <Badge variant="secondary">{cart.length}</Badge>
            )}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-3">
              <ShoppingCart className="h-12 w-12 opacity-30" />
              <p className="text-sm">Cart is empty</p>
            </div>
          ) : (
            <>
              {/* Cart items */}
              <div className="space-y-3">
                {cart.map((item) => {
                  const unitLabel = item.unit_label || 'unit';
                  const unitLabelCap = unitLabel.charAt(0).toUpperCase() + unitLabel.slice(1);
                  const pricePerStripe = item.units_per_pack
                    ? item.selling_price / item.units_per_pack
                    : item.selling_price;

                  return (
                    <div key={`${item.id}-${item.saleType}`} className="border rounded-lg p-3 space-y-3 bg-card">
                      {/* Name + remove */}
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium text-sm leading-tight">{item.name}</p>
                        <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => onRemove(item.id, item.saleType)}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>

                      {/* Sale type toggle (only if item supports strip selling) */}
                      {item.units_per_pack && (
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant={item.saleType === 'by_stripe' ? 'default' : 'outline'}
                            className="flex-1 h-7 text-xs"
                            onClick={() => item.saleType !== 'by_stripe' && onChangeSaleType(item.id, 'by_stripe')}
                          >
                            By {unitLabelCap}
                          </Button>
                          <Button
                            size="sm"
                            variant={item.saleType === 'full_pack' ? 'default' : 'outline'}
                            className="flex-1 h-7 text-xs"
                            onClick={() => item.saleType !== 'full_pack' && onChangeSaleType(item.id, 'full_pack')}
                          >
                            Full Pack
                          </Button>
                        </div>
                      )}

                      {/* Quantity controls */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {item.item_type === 'measurable' ? (() => {
                            const currentQty = item.saleType === 'by_stripe' ? (item.stripesCount ?? 1) : item.quantity;
                            const wholePart = Math.floor(currentQty);
                            const decPart = Math.round((currentQty - wholePart) * 100);
                            const measurableUnit = item.unit_label || 'unit';
                            return (
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  min="0"
                                  value={wholePart}
                                  onChange={(e) => {
                                    const w = parseInt(e.target.value) || 0;
                                    const newQty = parseFloat((w + decPart / 100).toFixed(2));
                                    if (newQty > 0 && onSetMeasurableQuantity) {
                                      onSetMeasurableQuantity(item.id, newQty);
                                    }
                                  }}
                                  className="w-14 text-sm font-medium text-center border rounded-md h-7 bg-background px-1 focus:outline-none focus:ring-1 focus:ring-ring"
                                />
                                <span className="text-sm font-bold">.</span>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  maxLength={2}
                                  value={decPart.toString().padStart(2, '0')}
                                  onChange={(e) => {
                                    const val = e.target.value.replace(/[^0-9]/g, '').slice(0, 2);
                                    const d = parseInt(val || '0');
                                    const newQty = parseFloat((wholePart + d / 100).toFixed(2));
                                    if (newQty > 0 && onSetMeasurableQuantity) {
                                      onSetMeasurableQuantity(item.id, newQty);
                                    }
                                  }}
                                  className="w-10 text-sm font-medium text-center border rounded-md h-7 bg-background px-1 focus:outline-none focus:ring-1 focus:ring-ring"
                                />
                                <span className="text-xs text-muted-foreground">{measurableUnit}</span>
                              </div>
                            );
                          })() : (
                            <>
                              <Button
                                size="icon"
                                variant="outline"
                                className="h-7 w-7"
                                onClick={() => onUpdateQuantity(item.id, item.saleType, -1)}
                              >
                                <Minus className="h-3 w-3" />
                              </Button>
                              {item.saleType === 'by_stripe' ? (
                                <input
                                  type="number"
                                  step="1"
                                  min="1"
                                  value={Math.max(1, Math.round(item.stripesCount ?? 1))}
                                  onChange={(e) => {
                                    const val = parseInt(e.target.value, 10);
                                    if (!isNaN(val) && val > 0) {
                                      const current = Math.max(1, Math.round(item.stripesCount ?? 1));
                                      const delta = val - current;
                                      if (delta !== 0) onUpdateQuantity(item.id, item.saleType, delta);
                                    }
                                  }}
                                  className="w-16 text-sm font-medium text-center border rounded-md h-7 bg-background px-1 focus:outline-none focus:ring-1 focus:ring-ring"
                                />
                              ) : (
                                <span className="text-sm font-medium min-w-[2rem] text-center">
                                  {item.quantity}
                                </span>
                              )}
                              <Button
                                size="icon"
                                variant="outline"
                                className="h-7 w-7"
                                onClick={() => onUpdateQuantity(item.id, item.saleType, 1)}
                              >
                                <Plus className="h-3 w-3" />
                              </Button>
                              <span className="text-xs text-muted-foreground">
                                {item.saleType === 'by_stripe' ? `${unitLabel}s` : 'packs'}
                              </span>
                            </>
                          )}
                        </div>
                        <span className="text-sm font-semibold">ETB {item.total.toFixed(2)}</span>
                      </div>

                      {/* Price breakdown */}
                      <p className="text-xs text-muted-foreground">
                        {item.saleType === 'full_pack'
                          ? `ETB ${item.selling_price} × ${item.quantity}`
                          : `ETB ${pricePerStripe.toFixed(2)} × ${item.stripesCount} ${unitLabel}s`}
                      </p>

                      {/* Leftover strip info for by_stripe sales */}
                      {item.saleType === 'by_stripe' && item.units_per_pack && item.stripesCount && (() => {
                        // open_pack_units is already in real decimal units (normalized in fetchMedicines)
                        const openPack = item.open_pack_units || 0;
                        const uPP = item.units_per_pack;
                        const sold = item.stripesCount;

                        // 1. Consume from open pack first (exact arithmetic)
                        const soldFromOpen = Math.min(sold, openPack);
                        const remainingInOpen = parseFloat((openPack - soldFromOpen).toFixed(6));

                        // 2. Remainder that needs new sealed packs
                        const needFromNew = parseFloat((sold - soldFromOpen).toFixed(6));
                        const packsToOpen = needFromNew > 0 ? Math.ceil(needFromNew / uPP) : 0;

                        // 3. Leftover units in the last newly opened pack
                        // e.g. need 1 unit from a 3-unit pack → 2 units leftover
                        const usedFromLastPack = needFromNew > 0 ? needFromNew % uPP || (needFromNew > 0 ? uPP : 0) : 0;
                        const leftoverInNewPack = packsToOpen > 0
                          ? parseFloat((uPP * packsToOpen - needFromNew).toFixed(6))
                          : 0;

                        // Total opened packs in this sale (opened because of unit selling)
                        const totalOpenedPacks = packsToOpen + (openPack > 0 ? 1 : 0);
                        // Total original pack stock the item had
                        const totalPacks = item.stock_quantity;

                        // Remaining units in open pack after sale — display as fraction A/B
                        // After sale: if we still have remainingInOpen from the old open pack
                        // OR leftoverInNewPack from a newly opened pack
                        const finalRemainingUnits = remainingInOpen > 0
                          ? remainingInOpen
                          : leftoverInNewPack > 0 ? leftoverInNewPack : 0;

                        const showFraction = finalRemainingUnits > 0;

                        return (
                          <div className="text-xs space-y-1 bg-muted/50 rounded px-2 py-1.5 border border-border/60 mt-1">
                            {soldFromOpen > 0 && (
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">From open pack:</span>
                                <span className="font-medium">{soldFromOpen} {unitLabel}</span>
                              </div>
                            )}
                            {showFraction && (
                              <div className="flex justify-between text-warning">
                                <span>Remaining in open pack:</span>
                                <span className="font-medium">{finalRemainingUnits}/{uPP} {unitLabel}</span>
                              </div>
                            )}
                            {packsToOpen > 0 && (
                              <div className="flex justify-between text-muted-foreground">
                                <span>Packs to open:</span>
                                <span className="font-medium">{packsToOpen} pack{packsToOpen > 1 ? 's' : ''}</span>
                              </div>
                            )}
                            {totalOpenedPacks > 0 && (
                              <div className="flex justify-between font-medium">
                                <span>Opened packs:</span>
                                <span>{totalOpenedPacks} opened from {totalPacks} total</span>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>

              <Separator />

              {/* Customer */}
              <div className="space-y-1.5">
                <Label className="text-xs">Customer (optional)</Label>
                {/* Search input */}
                <div className="relative">
                  <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Search by name or phone..."
                    value={customerSearch}
                    onChange={e => setCustomerSearch(e.target.value)}
                    className="h-8 pl-7 text-xs"
                  />
                </div>
                <Select value={selectedCustomerId} onValueChange={id => { onSelectCustomer(id); setCustomerSearch(''); }}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Walk-in customer" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Walk-in (no customer)</SelectItem>
                    {filteredCustomers.map(c => {
                      const debt = c.computed_debt || 0;
                      return (
                        <SelectItem key={c.id} value={c.id}>
                          <span className="flex items-center gap-1">
                            {c.name}
                            {c.phone ? <span className="text-muted-foreground"> — 📞 {c.phone}</span> : null}
                            {debt > 0 ? (
                              <span className="text-destructive font-medium"> — 🔴 Debt: {debt.toFixed(2)} ETB</span>
                            ) : null}
                          </span>
                        </SelectItem>
                      );
                    })}
                    {filteredCustomers.length === 0 && customerSearch && (
                      <div className="py-2 px-3 text-xs text-muted-foreground">No customers match "{customerSearch}"</div>
                    )}
                  </SelectContent>
              </Select>
              {/* Credit info for selected customer */}
              {selectedCustomer && selectedCustomerId !== 'none' && (
                <div className="space-y-2 p-2 rounded-lg border bg-muted/30">
                  <div className="flex items-center gap-2 flex-wrap">
                    <CreditScoreBadge score={selectedCustomer.credit_score ?? 50} />
                  </div>
                  <DebtProgressBar
                    currentDebt={selectedCustomer.computed_debt || 0}
                    maxCreditLimit={selectedCustomer.max_credit_limit ?? 5000}
                  />
                </div>
              )}
            </div>

              {/* Payment Method */}
              <div className="space-y-1.5">
                <Label className="text-xs">Payment Method</Label>
                <Select value={paymentMethod} onValueChange={onPaymentMethodChange}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
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

              {/* Discount */}
              <div className="space-y-1.5">
                <Label className="text-xs">Discount (%)</Label>
                <div className="flex items-center gap-2">
                  <Percent className="h-4 w-4 text-muted-foreground shrink-0" />
                  <Input
                    type="number" min="0" max="100"
                    value={discountPercent}
                    onChange={(e) => onDiscountChange(Math.max(0, Math.min(100, Number(e.target.value))))}
                    placeholder="0"
                    className="h-9 text-sm"
                  />
                </div>
              </div>

              <Separator />

              {/* Totals */}
              <div className="space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>ETB {subtotal.toFixed(2)}</span></div>
                {discount > 0 && <div className="flex justify-between text-success"><span>Discount ({discountPercent}%)</span><span>−ETB {discount.toFixed(2)}</span></div>}
                <div className="flex justify-between font-bold text-base pt-1"><span>Total</span><span>ETB {total.toFixed(2)}</span></div>
              </div>

              {/* Amount Received */}
              <div className="space-y-1.5">
                <Label className="text-xs flex items-center gap-1">
                  <Wallet className="h-3.5 w-3.5" /> Amount Received (ETB)
                </Label>
                <Input
                  type="number" step="0.01" min="0"
                  value={amountReceived}
                  onChange={e => onAmountReceivedChange(e.target.value)}
                  placeholder={total > 0 ? total.toFixed(2) : '0.00'}
                  className="h-9 text-sm"
                />
              </div>

              {/* Shortfall */}
              {hasShortfall && selectedCustomerId !== 'none' && (
                <div className="rounded-md bg-destructive/10 border border-destructive/20 p-2.5 text-xs text-destructive">
                  Short by ETB {(total - receivedAmount).toFixed(2)} — will be recorded as debt
                </div>
              )}

              {/* Change handling */}
              {hasChange && (
                <div className="rounded-md bg-primary/10 border border-primary/20 p-3 space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium flex items-center gap-1">
                      <ArrowLeftRight className="h-4 w-4" /> Change:
                    </span>
                    <span className="font-bold text-primary">ETB {changeAmount.toFixed(2)}</span>
                  </div>

                  {!changeAction && (
                    <div className="flex gap-2">
                      <Button size="sm" variant="default" className="flex-1" onClick={() => onChangeAction('keep_profit')}>Keep Change</Button>
                      <Button size="sm" variant="outline" className="flex-1" onClick={() => onChangeAction('give_change')}>Give Change</Button>
                    </div>
                  )}

                  {changeAction === 'keep_profit' && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-primary">Keep Change selected</span>
                        <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={() => { onChangeAction(null); onKeepChangeOption('profit'); }}>Change</Button>
                      </div>
                      {customerHasDebt ? (
                        <div className="space-y-2">
                          <p className="text-xs text-muted-foreground">Customer has debt of ETB {(selectedCustomer?.computed_debt || 0).toFixed(2)}. How to handle?</p>
                          <RadioGroup value={keepChangeOption} onValueChange={(v: any) => onKeepChangeOption(v)} className="space-y-1">
                            <div className="flex items-center gap-2">
                              <RadioGroupItem value="deduct_debt" id="opt-debt-sl" />
                              <Label htmlFor="opt-debt-sl" className="text-xs cursor-pointer">
                                Deduct ETB {Math.min(changeAmount, selectedCustomer?.computed_debt || 0).toFixed(2)} from customer debt
                              </Label>
                            </div>
                            <div className="flex items-center gap-2">
                              <RadioGroupItem value="profit" id="opt-profit-sl" />
                              <Label htmlFor="opt-profit-sl" className="text-xs cursor-pointer">Tip (keep as extra profit)</Label>
                            </div>
                          </RadioGroup>
                        </div>
                      ) : (
                        <p className="text-xs text-success bg-success/10 rounded px-2 py-1">
                          ETB {changeAmount.toFixed(2)} will be recorded as extra profit
                        </p>
                      )}
                    </div>
                  )}

                  {changeAction === 'give_change' && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Returning ETB {changeAmount.toFixed(2)} to customer</span>
                      <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={() => onChangeAction(null)}>Change</Button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer checkout button */}
        <div className="border-t p-4 bg-card">
          {/* Credit denied warning */}
          {creditCheck && !creditCheck.allowed && (
            <div className="px-4 pb-2">
              <div className="rounded-md bg-destructive/10 border border-destructive/30 p-3 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                <div className="text-xs text-destructive">
                  <p className="font-semibold">Credit Denied</p>
                  <p>{creditCheck.reason}</p>
                </div>
              </div>
            </div>
          )}
          <Button
            onClick={onCheckout}
            className="w-full"
            disabled={processing || cart.length === 0 || (hasChange && !changeAction) || (hasShortfall && selectedCustomerId === 'none') || (creditCheck != null && !creditCheck.allowed)}
          >
            <CreditCard className="h-4 w-4 mr-2" />
            {processing ? 'Processing...' : `Checkout · ETB ${total.toFixed(2)}`}
          </Button>
          {hasShortfall && selectedCustomerId === 'none' && (
            <p className="text-xs text-destructive text-center mt-1">
              Walk-in customers cannot purchase on debt. Please collect full amount or select a customer.
            </p>
          )}
        </div>
      </div>
    </>
  );
}
