import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';

interface Medicine {
  id: string;
  name: string;
  generic_name?: string;
  selling_price: number;
  stock_quantity: number;
  units_per_pack?: number;
  open_pack_units?: number;
  unit_label?: string;
  item_type?: string;
}

interface AddToCartDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  medicine: Medicine | null;
  onAddToCart: (medicine: Medicine, saleType: 'full_pack' | 'by_stripe', stripesCount: number) => void;
}

export default function AddToCartDialog({ open, onOpenChange, medicine, onAddToCart }: AddToCartDialogProps) {
  const getDefaultSaleType = () => medicine?.units_per_pack ? 'by_stripe' : 'full_pack';
  const [saleType, setSaleType] = useState<'full_pack' | 'by_stripe'>(getDefaultSaleType());
  const [stripesCount, setStripesCount] = useState<number>(1);
  const [packQuantity, setPackQuantity] = useState<number>(1);
  const [stripInputValue, setStripInputValue] = useState<string>('1');
  const [measurableWhole, setMeasurableWhole] = useState<string>('1');
  const [measurableDecimal, setMeasurableDecimal] = useState<string>('0');

  if (!medicine) return null;

  const isMeasurableItem = medicine.item_type === 'measurable';
  const unitLabel = medicine.unit_label || (isMeasurableItem ? 'kg' : 'unit');
  const unitLabelCap = unitLabel.charAt(0).toUpperCase() + unitLabel.slice(1);
  const pricePerStripe = medicine.units_per_pack
    ? (medicine.selling_price / medicine.units_per_pack).toFixed(2)
    : '0';

  const totalAvailableStripes = medicine.units_per_pack
    ? (medicine.stock_quantity * medicine.units_per_pack) + (medicine.open_pack_units || 0)
    : 0;

  const getMeasurableQuantity = () => {
    const whole = parseInt(measurableWhole) || 0;
    const padded = (measurableDecimal || '0').padEnd(2, '0').slice(0, 2);
    const dec = parseInt(padded) / 100;
    return parseFloat((whole + dec).toFixed(2));
  };

  const handleSaleTypeChange = (val: 'full_pack' | 'by_stripe') => {
    setSaleType(val);
    setStripesCount(1);
    setStripInputValue('1');
    setPackQuantity(1);
  };

  const resetState = () => {
    setSaleType(getDefaultSaleType());
    setStripesCount(1);
    setStripInputValue('1');
    setPackQuantity(1);
    setMeasurableWhole('1');
    setMeasurableDecimal('0');
  };

  const handleAdd = () => {
    if (isMeasurableItem) {
      const qty = getMeasurableQuantity();
      if (qty <= 0 || qty > medicine.stock_quantity) return;
      onAddToCart(medicine, 'full_pack', qty);
    } else {
      const finalCount = saleType === 'by_stripe' ? stripesCount : packQuantity;
      if (finalCount <= 0) return;
      onAddToCart(medicine, saleType, finalCount);
    }
    onOpenChange(false);
    resetState();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => {
      if (!v) resetState();
      onOpenChange(v);
    }}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Add to Cart</DialogTitle>
          <DialogDescription>
            {medicine.name}
            {medicine.generic_name && ` (${medicine.generic_name})`}
            {isMeasurableItem && <Badge variant="secondary" className="ml-2">Measurable</Badge>}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Info section */}
          <div className="space-y-2 bg-muted/40 rounded-lg p-3">
            <div className="flex justify-between text-sm">
              <span>{isMeasurableItem ? `Price per ${unitLabel}:` : 'Full Pack Price:'}</span>
              <span className="font-medium">ETB {medicine.selling_price}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>Available Stock:</span>
              <Badge variant="secondary">
                {medicine.stock_quantity} {isMeasurableItem ? unitLabel : 'packs'}
              </Badge>
            </div>
            {!isMeasurableItem && medicine.units_per_pack && (
              <>
                <div className="flex justify-between text-sm">
                  <span>{unitLabelCap}s Per Pack:</span>
                  <Badge variant="outline">{medicine.units_per_pack}</Badge>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Price Per {unitLabelCap}:</span>
                  <span className="font-medium">ETB {pricePerStripe}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Total Available {unitLabelCap}s:</span>
                  <Badge variant="secondary">{totalAvailableStripes}</Badge>
                </div>
                {(medicine.open_pack_units || 0) > 0 && (
                  <div className="flex justify-between text-sm">
                    <span>Open Pack {unitLabelCap}s:</span>
                    <Badge variant="outline">{medicine.open_pack_units}</Badge>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Measurable items: dual input */}
          {isMeasurableItem && (
            <div className="space-y-2">
              <Label>Quantity ({unitLabel})</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={measurableWhole}
                  onChange={(e) => setMeasurableWhole(e.target.value)}
                  placeholder="Whole"
                  className="flex-1"
                />
                <span className="text-lg font-bold">.</span>
                <Input
                  type="text"
                  inputMode="numeric"
                  maxLength={2}
                  value={measurableDecimal}
                  onChange={(e) => {
                    const val = e.target.value.replace(/[^0-9]/g, '').slice(0, 2);
                    setMeasurableDecimal(val);
                  }}
                  placeholder="00"
                  className="w-20 text-center"
                />
                <span className="text-sm text-muted-foreground">{unitLabel}</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Total: ETB {(getMeasurableQuantity() * medicine.selling_price).toFixed(2)}
              </p>
            </div>
          )}

          {/* Non-measurable: Sale Type */}
          {!isMeasurableItem && (
            <>
              <div className="space-y-2">
                <Label htmlFor="sale-type">Sale Type</Label>
                <Select value={saleType} onValueChange={(value: any) => handleSaleTypeChange(value)}>
                  <SelectTrigger id="sale-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full_pack">Full Pack</SelectItem>
                    {medicine.units_per_pack && (
                      <SelectItem value="by_stripe">By {unitLabelCap}</SelectItem>
                    )}
                  </SelectContent>
                </Select>
                {medicine.units_per_pack && saleType === 'by_stripe' && (
                  <p className="text-xs text-primary font-medium">✓ Selling by individual {unitLabel}</p>
                )}
              </div>

              {/* Quantity for full pack — integer only */}
              {saleType === 'full_pack' && (
                <div className="space-y-2">
                  <Label htmlFor="pack-quantity">Number of Packs</Label>
                  <Input
                    id="pack-quantity"
                    type="number"
                    min="1"
                    step="1"
                    max={medicine.stock_quantity}
                    value={packQuantity}
                    onChange={(e) => setPackQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                  />
                  <p className="text-sm text-muted-foreground">
                    Total: ETB {(packQuantity * medicine.selling_price).toFixed(2)}
                  </p>
                </div>
              )}

              {/* Quantity for by_stripe — integer only for full_pcs */}
              {saleType === 'by_stripe' && medicine.units_per_pack && (
                <div className="space-y-2">
                  <Label htmlFor="stripes-count">Number of {unitLabelCap}s</Label>
                  <Input
                    id="stripes-count"
                    type="number"
                    step="1"
                    min="1"
                    max={totalAvailableStripes}
                    value={stripInputValue}
                    onChange={(e) => {
                      setStripInputValue(e.target.value);
                      const val = parseInt(e.target.value);
                      if (!isNaN(val) && val > 0) setStripesCount(val);
                    }}
                    onBlur={() => {
                      const val = parseInt(stripInputValue);
                      const clamped = isNaN(val) || val <= 0 ? 1 : Math.min(val, totalAvailableStripes);
                      setStripesCount(clamped);
                      setStripInputValue(String(clamped));
                    }}
                  />
                  <p className="text-sm text-muted-foreground">
                    Total: ETB {(stripesCount * parseFloat(pricePerStripe)).toFixed(2)}
                  </p>
                </div>
              )}
            </>
          )}

          <div className="flex gap-2 pt-2">
            <Button onClick={handleAdd} className="flex-1">
              Add to Cart
            </Button>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
