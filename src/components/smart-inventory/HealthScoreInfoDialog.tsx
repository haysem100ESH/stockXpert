import { useState } from 'react';
import { Info, Sparkles, TrendingUp, AlertTriangle, Package, Skull, CalendarDays, ShoppingCart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';

interface Props {
  isPharmacy?: boolean;
}

export default function HealthScoreInfoDialog({ isPharmacy = false }: Props) {
  const [open, setOpen] = useState(false);
  const itemLabel = isPharmacy ? 'medicine' : 'item';
  const itemLabelPlural = isPharmacy ? 'medicines' : 'items';

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Info className="h-4 w-4" />
          <span className="hidden sm:inline">How it works</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[85vh] p-0">
        <DialogHeader className="p-6 pb-3 border-b">
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Sparkles className="h-5 w-5 text-primary" />
            Smart Inventory User Manual
          </DialogTitle>
          <DialogDescription>
            Understand how the Health Score, alerts, and predictions are calculated for every {itemLabel} in your inventory.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[65vh] px-6 py-4">
          <div className="space-y-6 pb-6">
            {/* Health Score Levels */}
            <section>
              <h3 className="font-semibold text-base mb-3 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" /> Health Score Levels
              </h3>
              <p className="text-sm text-muted-foreground mb-3">
                Each {itemLabel} receives a score from <b>0 to 100</b> reflecting how well it is performing. The dashboard's
                <b> overall Health Score</b> is the average of all individual {itemLabel} scores in your branch.
              </p>
              <div className="grid gap-2">
                <ScoreRow color="bg-green-500" label="Excellent" range="80 – 100" desc={`Healthy stock, steady sales, no expiry or dead stock concerns.`} />
                <ScoreRow color="bg-blue-500" label="Good" range="60 – 79" desc={`Performing well, but may need minor attention (e.g. slight overstock or upcoming expiry).`} />
                <ScoreRow color="bg-amber-500" label="At Risk" range="40 – 59" desc={`Action recommended — slow sales, overstock, near expiry, or low stock.`} />
                <ScoreRow color="bg-destructive" label="Critical" range="< 40" desc={`Urgent attention required — dead stock, expired, or stock-out risk.`} />
              </div>
            </section>

            <Separator />

            {/* How the score is calculated */}
            <section>
              <h3 className="font-semibold text-base mb-3 flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" /> How the Score is Calculated
              </h3>
              <p className="text-sm text-muted-foreground mb-3">
                Every {itemLabel} starts with a baseline of <b>50 points</b>. Points are added or subtracted based on these factors:
              </p>
              <div className="space-y-2 text-sm">
                <ScoreFactor sign="+" range="up to +20" title="Sales velocity (ADC)" desc={`Average Daily Consumption from the last 30 days. Higher daily sales = more points.`} />
                <ScoreFactor sign="+" range="up to +30" title="Stock vs Demand balance" desc={`Compares current stock against predicted 14-day demand. Best score when stock covers 0.8× to 2× of expected demand.`} />
                <ScoreFactor sign="+" range="+15" title="Has stock but no sales history" desc={`New ${itemLabelPlural} with stock receive a small bonus while learning their sales pattern.`} />
                <ScoreFactor sign="−" range="−5 to −30" title="Expiry proximity" desc={`Penalties grow as expiry approaches: <90 days (−5), <60 days (−15), <30 days (−25), expired (−30).`} />
                <ScoreFactor sign="−" range="−20" title="Dead stock" desc={`No sales in the last 60 days while stock is on hand.`} />
              </div>
              <p className="text-xs text-muted-foreground mt-3 italic">
                Final score is clamped between 0 and 100.
              </p>
            </section>

            <Separator />

            {/* Predicted Demand */}
            <section>
              <h3 className="font-semibold text-base mb-3 flex items-center gap-2">
                <ShoppingCart className="h-4 w-4 text-primary" /> Predicted Demand & Reorder Logic
              </h3>
              <div className="space-y-2 text-sm">
                <Bullet><b>ADC (Avg Daily Consumption):</b> total quantity sold in the last 30 days ÷ 30.</Bullet>
                <Bullet><b>Predicted 14-day demand:</b> ADC × 14 × seasonal multiplier (based on the same month's sales in past years).</Bullet>
                <Bullet><b>Safety stock:</b> 20% of the predicted 14-day demand — a buffer for unexpected spikes.</Bullet>
                <Bullet><b>Needs Reorder:</b> triggered when current stock falls below the predicted demand <i>or</i> below the configured minimum stock level.</Bullet>
                <Bullet><b>Suggested Reorder Quantity:</b> enough to bring stock up to (predicted demand + safety stock), or to the minimum stock level — whichever is higher.</Bullet>
                <Bullet><b>Days Remaining:</b> current stock ÷ ADC.</Bullet>
              </div>
            </section>

            <Separator />

            {/* Alerts */}
            <section>
              <h3 className="font-semibold text-base mb-3 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-primary" /> Alert Categories
              </h3>
              <div className="space-y-3 text-sm">
                <AlertRow icon={<TrendingUp className="h-4 w-4 text-amber-500" />} title="Need Reorder"
                  desc={`Stock is running low compared to predicted demand or below the minimum threshold.`} />
                <AlertRow icon={<AlertTriangle className="h-4 w-4 text-destructive" />} title="Stock-Out Risk"
                  desc={`Less than 7 days of stock remaining at current sales pace.`} />
                <AlertRow icon={<Skull className="h-4 w-4 text-orange-500" />} title="Dead Stock"
                  desc={`No sales in the last 60 days while units are still on hand. Consider promotions or transfers.`} />
                {isPharmacy && (
                  <AlertRow icon={<CalendarDays className="h-4 w-4 text-red-500" />} title="Expiry Alerts"
                    desc={`Warning (<90 days), Risk (<60 days), Critical (<30 days), Expired (≤0 days).`} />
                )}
              </div>
            </section>

            <Separator />

            {/* New items */}
            <section>
              <h3 className="font-semibold text-base mb-3 flex items-center gap-2">
                <Package className="h-4 w-4 text-primary" /> How New {isPharmacy ? 'Medicines' : 'Items'} Are Treated
              </h3>
              <div className="space-y-2 text-sm">
                <Bullet>
                  A new {itemLabel} with no sales history starts at <b>~65 points</b> (50 baseline + 15 for having stock) — placed in the <Badge variant="secondary">Good</Badge> tier.
                </Bullet>
                <Bullet>
                  ADC and predicted demand stay at <b>0</b> until sales begin, so it will <b>not</b> appear in "Stock-Out Risk" or "Need Reorder" lists initially.
                </Bullet>
                <Bullet>
                  After <b>30 days of sales data</b>, predictions become reliable and the score reflects real performance.
                </Bullet>
                <Bullet>
                  After <b>60 days with zero sales</b>, the {itemLabel} is flagged as <Badge variant="outline">Dead Stock</Badge> (−20 points).
                </Bullet>
                <Bullet>
                  Items sold frequently quickly climb toward the <Badge className="bg-green-500 hover:bg-green-500">Excellent</Badge> tier as ADC and stock-vs-demand bonuses kick in.
                </Bullet>
              </div>
            </section>

            <Separator />

            {/* Seasonal */}
            <section>
              <h3 className="font-semibold text-base mb-3">Seasonal Intelligence</h3>
              <p className="text-sm text-muted-foreground">
                The system analyses the last 12 months of sales for every {itemLabel} and applies a <b>seasonal multiplier</b> to the
                predicted demand. {isPharmacy ? 'Cold & flu medicines' : 'Seasonal items'} that historically sell more in the current month will
                show higher reorder suggestions, helping you prepare for upcoming peaks.
              </p>
            </section>

            <Separator />

            {/* Tips */}
            <section>
              <h3 className="font-semibold text-base mb-3">Tips to Improve Your Health Score</h3>
              <div className="space-y-2 text-sm">
                <Bullet>Reorder flagged {itemLabelPlural} promptly to avoid stock-outs.</Bullet>
                <Bullet>Run promotions or transfer dead stock to other branches.</Bullet>
                {isPharmacy && <Bullet>Sell or return near-expiry {itemLabelPlural} before the critical window.</Bullet>}
                <Bullet>Keep <b>minimum stock levels</b> accurate — they directly affect reorder alerts.</Bullet>
                <Bullet>Record sales consistently — predictions improve with more data.</Bullet>
              </div>
            </section>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function ScoreRow({ color, label, range, desc }: { color: string; label: string; range: string; desc: string }) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg border bg-card">
      <div className={`h-3 w-3 rounded-full mt-1.5 ${color}`} />
      <div className="flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium">{label}</span>
          <Badge variant="outline" className="text-xs font-mono">{range}</Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-1">{desc}</p>
      </div>
    </div>
  );
}

function ScoreFactor({ sign, range, title, desc }: { sign: string; range: string; title: string; desc: string }) {
  const isPositive = sign === '+';
  return (
    <div className="flex gap-3 p-2.5 rounded-md bg-muted/40">
      <Badge
        variant="outline"
        className={`font-mono text-xs shrink-0 ${isPositive ? 'border-green-500/40 text-green-600 dark:text-green-400' : 'border-destructive/40 text-destructive'}`}
      >
        {range}
      </Badge>
      <div>
        <p className="font-medium text-sm">{title}</p>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="text-primary mt-1">•</span>
      <p className="flex-1">{children}</p>
    </div>
  );
}

function AlertRow({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5">{icon}</div>
      <div>
        <p className="font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
    </div>
  );
}
