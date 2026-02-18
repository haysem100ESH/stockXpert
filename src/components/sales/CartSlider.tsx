import { useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ShoppingCart, Trash2, CreditCard, Percent, ArrowLeftRight, Wallet, X, Plus, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CartItem {
  id: string;
  name: string;
  selling_price: number;
  stock_quantity: number;
  units_per_pack?: number;
  open_pack_units?: number;
  unit_label?: string;
  quantity: number;
  total: number;
  saleType: 'full_pack' | 'by_stripe';
  stripesCount?: number;
}

interface Customer {
  id: string;
  name: string;
  phone?: string | null;
  current_debt?: number;
}

type ChangeAction = 'keep_profit' | 'deduct_debt' | 'give_change' | null;

interface CartSliderProps {
  open: boolean;
  onClose: () => void;
  cart: CartItem[];
  onRemove: (id: string, saleType: 'full_pack' | 'by_stripe') => void;
  onUpdateQuantity: (id: string, saleType: 'full_pack' | 'by_stripe', delta: number) => void;
  onChangeSaleType: (id: string, newSaleType: 'full_pack' | 'by_stripe') => void;
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
}

export default function CartSlider({
  open, onClose,
  cart, onRemove, onUpdateQuantity, onChangeSaleType,
  customers, selectedCustomerId, onSelectCustomer,
  paymentMethod, onPaymentMethodChange,
  discountPercent, onDiscountChange,
  amountReceived, onAmountReceivedChange,
  changeAction, onChangeAction,
  keepChangeOption, onKeepChangeOption,
  subtotal, discount, total,
  processing, onCheckout,
}: CartSliderProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  // Close on overlay click
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose();
  };

  const receivedAmount = parseFloat(amountReceived) || 0;
  const changeAmount = receivedAmount - total;
  const hasChange = changeAmount > 0.001;
  const hasShortfall = receivedAmount > 0 && receivedAmount < total;

  const selectedCustomer = customers.find(c => c.id === selectedCustomerId);
  const customerHasDebt = selectedCustomer && (selectedCustomer.current_debt || 0) > 0;

  return (
    <>
      {/* Backdrop — mobile only */}
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
                          <Button
                            size="icon"
                            variant="outline"
                            className="h-7 w-7"
                            onClick={() => onUpdateQuantity(item.id, item.saleType, -1)}
                          >
                            <Minus className="h-3 w-3" />
                          </Button>
                          <span className="text-sm font-medium min-w-[2rem] text-center">
                            {item.saleType === 'by_stripe' ? item.stripesCount : item.quantity}
                          </span>
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
                        </div>
                        <span className="text-sm font-semibold">ETB {item.total.toFixed(2)}</span>
                      </div>

                      {/* Price breakdown */}
                      <p className="text-xs text-muted-foreground">
                        {item.saleType === 'full_pack'
                          ? `ETB ${item.selling_price} × ${item.quantity}`
                          : `ETB ${pricePerStripe.toFixed(2)} × ${item.stripesCount} ${unitLabel}s`}
                      </p>
                    </div>
                  );
                })}
              </div>

              <Separator />

              {/* Customer */}
              <div className="space-y-1.5">
                <Label className="text-xs">Customer (optional)</Label>
                <Select value={selectedCustomerId} onValueChange={onSelectCustomer}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Walk-in customer" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Walk-in (no customer)</SelectItem>
                    {customers.map(c => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}{c.phone ? ` — ${c.phone}` : ''}
                        {(c.current_debt || 0) > 0 ? ` · Debt: ETB ${c.current_debt}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                  placeholder={total.toFixed(2)}
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
                          <p className="text-xs text-muted-foreground">Customer has debt of ETB {selectedCustomer?.current_debt}. How to handle?</p>
                          <RadioGroup value={keepChangeOption} onValueChange={(v: any) => onKeepChangeOption(v)} className="space-y-1">
                            <div className="flex items-center gap-2">
                              <RadioGroupItem value="deduct_debt" id="opt-debt-sl" />
                              <Label htmlFor="opt-debt-sl" className="text-xs cursor-pointer">
                                Deduct ETB {Math.min(changeAmount, selectedCustomer?.current_debt || 0).toFixed(2)} from customer debt
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
          <Button
            onClick={onCheckout}
            className="w-full"
            disabled={processing || cart.length === 0 || (hasChange && !changeAction)}
          >
            <CreditCard className="h-4 w-4 mr-2" />
            {processing ? 'Processing...' : `Checkout · ETB ${total.toFixed(2)}`}
          </Button>
        </div>
      </div>
    </>
  );
}
