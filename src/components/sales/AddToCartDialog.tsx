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
  const [saleType, setSaleType] = useState<'full_pack' | 'by_stripe'>('full_pack');
  const [stripesCount, setStripesCount] = useState<number>(1);

  if (!medicine) return null;

  const pricePerStripe = medicine.stripes_per_pack 
    ? (medicine.selling_price / medicine.stripes_per_pack).toFixed(2)
    : '0';
  
  const totalAvailableStripes = medicine.stripes_per_pack
    ? (medicine.stock_quantity * medicine.stripes_per_pack) + (medicine.open_pack_stripes || 0)
    : 0;

  const handleAdd = () => {
    if (saleType === 'by_stripe') {
      onAddToCart(medicine, saleType, stripesCount);
    } else {
      onAddToCart(medicine, saleType, 1);
    }
    onOpenChange(false);
    setSaleType('full_pack');
    setStripesCount(1);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Add to Cart</DialogTitle>
          <DialogDescription>
            {medicine.name}
            {medicine.generic_name && ` (${medicine.generic_name})`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Full Pack Price:</span>
              <span className="font-medium">ETB {medicine.selling_price}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>Available Stock:</span>
              <Badge variant="secondary">{medicine.stock_quantity} packs</Badge>
            </div>
            {medicine.stripes_per_pack && (
              <>
                <div className="flex justify-between text-sm">
                  <span>Stripes Per Pack:</span>
                  <Badge variant="outline">{medicine.stripes_per_pack}</Badge>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Price Per Stripe:</span>
                  <span className="font-medium">ETB {pricePerStripe}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Total Available Stripes:</span>
                  <Badge variant="secondary">{totalAvailableStripes}</Badge>
                </div>
                {medicine.open_pack_stripes > 0 && (
                  <div className="flex justify-between text-sm">
                    <span>Open Pack Stripes:</span>
                    <Badge variant="outline">{medicine.open_pack_stripes}</Badge>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="sale-type">Sale Type</Label>
            <Select value={saleType} onValueChange={(value: any) => setSaleType(value)}>
              <SelectTrigger id="sale-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="full_pack">Full Pack</SelectItem>
                {medicine.stripes_per_pack && (
                  <SelectItem value="by_stripe">By Stripe</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>

          {saleType === 'by_stripe' && medicine.stripes_per_pack && (
            <div className="space-y-2">
              <Label htmlFor="stripes-count">Number of Stripes</Label>
              <Input
                id="stripes-count"
                type="number"
                min="1"
                max={totalAvailableStripes}
                value={stripesCount}
                onChange={(e) => setStripesCount(parseInt(e.target.value) || 1)}
              />
              <p className="text-sm text-muted-foreground">
                Total: ETB {(stripesCount * parseFloat(pricePerStripe)).toFixed(2)}
              </p>
            </div>
          )}

          <div className="flex gap-2 pt-4">
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
