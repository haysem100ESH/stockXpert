import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SmartItem } from '@/hooks/useSmartInventory';
import { useSupplierIntelligence } from '@/hooks/useSupplierIntelligence';
import { ShoppingCart, Truck } from 'lucide-react';

interface ReorderSuggestionsProps {
  items: SmartItem[];
  isPharmacy: boolean;
}

export default function ReorderSuggestions({ items, isPharmacy }: ReorderSuggestionsProps) {
  const { getBestSupplierForItem, priceComparisons } = useSupplierIntelligence();
  const sorted = [...items].sort((a, b) => b.suggestedReorder - a.suggestedReorder);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShoppingCart className="h-5 w-5 text-amber-500" />
          Smart Reorder Suggestions
        </CardTitle>
        <CardDescription>
          {isPharmacy ? 'Medicines' : 'Items'} where current stock is below predicted 14-day demand. Best supplier recommendations included.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">
            All {isPharmacy ? 'medicines' : 'items'} are well-stocked for the next 14 days.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Current Stock</TableHead>
                  <TableHead className="text-right">14-Day Demand</TableHead>
                  <TableHead className="text-right">Safety Stock (20%)</TableHead>
                  <TableHead className="text-right">
                    <span className="text-amber-600 font-semibold">Suggested Reorder</span>
                  </TableHead>
                  <TableHead>Urgency</TableHead>
                  <TableHead>Best Supplier</TableHead>
                  <TableHead className="text-right">Est. Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((item) => {
                  const urgency = item.daysRemaining !== null && item.daysRemaining < 3
                    ? 'critical'
                    : item.daysRemaining !== null && item.daysRemaining < 7
                    ? 'high'
                    : 'medium';

                  const bestSupplier = getBestSupplierForItem(item.id);
                  const estCost = bestSupplier ? bestSupplier.price * item.suggestedReorder : null;

                  return (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell className="text-right">{item.currentStock}</TableCell>
                      <TableCell className="text-right">{Math.ceil(item.predictedDemand14)}</TableCell>
                      <TableCell className="text-right">{Math.ceil(item.safetyStock)}</TableCell>
                      <TableCell className="text-right font-bold text-amber-600">
                        +{item.suggestedReorder}
                      </TableCell>
                      <TableCell>
                        <Badge variant={urgency === 'critical' ? 'destructive' : urgency === 'high' ? 'secondary' : 'outline'}>
                          {urgency}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {bestSupplier ? (
                          <div className="flex items-center gap-1">
                            <Truck className="h-3 w-3 text-muted-foreground" />
                            <span className="text-sm">{bestSupplier.supplierName}</span>
                            <Badge variant="outline" className="text-xs ml-1">{bestSupplier.score}</Badge>
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-xs">No pricing data</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {estCost !== null ? (
                          <span className="font-medium">{estCost.toLocaleString()}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
