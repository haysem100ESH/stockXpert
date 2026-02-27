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
}

interface AddToCartDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  medicine: Medicine | null;
  onAddToCart: (medicine: Medicine, saleType: 'full_pack' | 'by_stripe', stripesCount: number) => void;
}

export default function AddToCartDialog({ open, onOpenChange, medicine, onAddToCart }: AddToCartDialogProps) {
  // Default to by_stripe if the medicine supports unit/strip selling
  const getDefaultSaleType = () => medicine?.units_per_pack ? 'by_stripe' : 'full_pack';
  const [saleType, setSaleType] = useState<'full_pack' | 'by_stripe'>(getDefaultSaleType());
  const [stripesCount, setStripesCount] = useState<number>(1);
  const [packQuantity, setPackQuantity] = useState<number>(1);
  const [stripInputValue, setStripInputValue] = useState<string>('1');

  if (!medicine) return null;

  const unitLabel = medicine.unit_label || 'unit';
  const unitLabelCap = unitLabel.charAt(0).toUpperCase() + unitLabel.slice(1);
  const pricePerStripe = medicine.units_per_pack
    ? (medicine.selling_price / medicine.units_per_pack).toFixed(2)
    : '0';

  const totalAvailableStripes = medicine.units_per_pack
    ? (medicine.stock_quantity * medicine.units_per_pack) + (medicine.open_pack_units || 0)
    : 0;

  const handleSaleTypeChange = (val: 'full_pack' | 'by_stripe') => {
    setSaleType(val);
    setStripesCount(1);
    setStripInputValue('1');
    setPackQuantity(1);
  };

  const handleAdd = () => {
    const finalCount = saleType === 'by_stripe' ? stripesCount : packQuantity;
    if (finalCount <= 0) return;
    onAddToCart(medicine, saleType, finalCount);
    onOpenChange(false);
    setSaleType(getDefaultSaleType());
    setStripesCount(1);
    setStripInputValue('1');
    setPackQuantity(1);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => {
      if (!v) {
        setSaleType(getDefaultSaleType());
        setStripesCount(1);
        setStripInputValue('1');
        setPackQuantity(1);
      }
      onOpenChange(v);
    }}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Add to Cart</DialogTitle>
          <DialogDescription>
            {medicine.name}
            {medicine.generic_name && ` (${medicine.generic_name})`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Info section */}
          <div className="space-y-2 bg-muted/40 rounded-lg p-3">
            <div className="flex justify-between text-sm">
              <span>Full Pack Price:</span>
              <span className="font-medium">ETB {medicine.selling_price}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>Available Stock:</span>
              <Badge variant="secondary">{medicine.stock_quantity} packs</Badge>
            </div>
            {medicine.units_per_pack && (
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

          {/* Sale Type */}
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

          {/* Quantity for full pack */}
          {saleType === 'full_pack' && (
            <div className="space-y-2">
              <Label htmlFor="pack-quantity">Number of Packs</Label>
              <Input
                id="pack-quantity"
                type="number"
                min="1"
                max={medicine.stock_quantity}
                value={packQuantity}
                onChange={(e) => setPackQuantity(Math.max(1, parseInt(e.target.value) || 1))}
              />
              <p className="text-sm text-muted-foreground">
                Total: ETB {(packQuantity * medicine.selling_price).toFixed(2)}
              </p>
            </div>
          )}

          {/* Quantity for by_stripe — supports decimals */}
          {saleType === 'by_stripe' && medicine.units_per_pack && (
            <div className="space-y-2">
              <Label htmlFor="stripes-count">Number of {unitLabelCap}s</Label>
              <Input
                id="stripes-count"
                type="number"
                step="0.25"
                min="0.25"
                max={totalAvailableStripes}
                value={stripInputValue}
                onChange={(e) => {
                  setStripInputValue(e.target.value);
                  const val = parseFloat(e.target.value);
                  if (!isNaN(val) && val > 0) setStripesCount(val);
                }}
                onBlur={() => {
                  const val = parseFloat(stripInputValue);
                  const clamped = isNaN(val) || val <= 0 ? 0.25 : Math.min(val, totalAvailableStripes);
                  setStripesCount(clamped);
                  setStripInputValue(String(clamped));
                }}
              />
              <p className="text-sm text-muted-foreground">
                Total: ETB {(stripesCount * parseFloat(pricePerStripe)).toFixed(2)}
              </p>
            </div>
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
