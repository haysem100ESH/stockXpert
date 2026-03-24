import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CalendarDays } from 'lucide-react';
import { SmartItem } from '@/hooks/useSmartInventory';

interface ExpiryRiskPanelProps {
  items: SmartItem[];
}

const alertConfig = {
  expired: { label: 'Expired', variant: 'destructive' as const, bg: 'bg-red-50 dark:bg-red-950/20' },
  critical: { label: '<30 Days', variant: 'destructive' as const, bg: 'bg-red-50/70 dark:bg-red-950/10' },
  risk: { label: '<60 Days', variant: 'secondary' as const, bg: 'bg-amber-50 dark:bg-amber-950/10' },
  warning: { label: '<90 Days', variant: 'outline' as const, bg: 'bg-yellow-50 dark:bg-yellow-950/10' },
};

export default function ExpiryRiskPanel({ items }: ExpiryRiskPanelProps) {
  const groups = {
    expired: items.filter(i => i.expiryAlertLevel === 'expired'),
    critical: items.filter(i => i.expiryAlertLevel === 'critical'),
    risk: items.filter(i => i.expiryAlertLevel === 'risk'),
    warning: items.filter(i => i.expiryAlertLevel === 'warning'),
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-red-500" />
          Expiry Risk Detection
        </CardTitle>
        <CardDescription>
          Medicines approaching expiration with tiered alert levels
        </CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">
            No expiry risks detected. All medicines are within safe expiry dates.
          </p>
        ) : (
          <div className="space-y-6">
            {(Object.keys(groups) as Array<keyof typeof groups>).map((level) => {
              const group = groups[level];
              if (group.length === 0) return null;
              const config = alertConfig[level];

              return (
                <div key={level}>
                  <div className="flex items-center gap-2 mb-3">
                    <Badge variant={config.variant}>{config.label}</Badge>
                    <span className="text-sm text-muted-foreground">{group.length} items</span>
                  </div>
                  <div className="grid gap-2">
                    {group.map((item) => (
                      <div key={item.id} className={`flex items-center justify-between p-3 border rounded-lg ${config.bg}`}>
                        <div>
                          <p className="font-medium">{item.name}</p>
                          <p className="text-sm text-muted-foreground">{item.category}</p>
                        </div>
                        <div className="text-right">
                          <Badge variant={config.variant} className="text-xs">
                            {item.daysUntilExpiry !== null
                              ? item.daysUntilExpiry <= 0
                                ? `Expired ${Math.abs(item.daysUntilExpiry)}d ago`
                                : `${item.daysUntilExpiry}d left`
                              : '—'}
                          </Badge>
                          <p className="text-xs text-muted-foreground mt-1">
                            {item.expiryDate ? new Date(item.expiryDate).toLocaleDateString() : '—'} | Stock: {item.currentStock}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
