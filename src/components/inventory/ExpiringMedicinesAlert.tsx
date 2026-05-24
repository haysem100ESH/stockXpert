import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { useInventoryAlerts } from '@/hooks/useInventoryAlerts';

export default function ExpiringMedicinesAlert() {
  const navigate = useNavigate();
  const { counts } = useInventoryAlerts();

  if (counts.total === 0) return null;

  const parts: string[] = [];
  if (counts.expired > 0) parts.push(`${counts.expired} expired`);
  if (counts.expiringSoon > 0) parts.push(`${counts.expiringSoon} expiring soon`);
  if (counts.outOfStock > 0) parts.push(`${counts.outOfStock} out of stock`);
  if (counts.lowStock > 0) parts.push(`${counts.lowStock} low stock`);

  return (
    <Alert variant="default" className="mb-4 border-amber-500 bg-amber-50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-200">
      <AlertTriangle className="h-4 w-4 flex-shrink-0" />
      <AlertDescription className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <span className="text-sm">⚠️ Inventory alerts: {parts.join(', ')}.</span>
        <Button variant="outline" size="sm" onClick={() => navigate('/smart-inventory')} className="flex-shrink-0 border-amber-600 text-amber-800 hover:bg-amber-100 dark:text-amber-200 dark:border-amber-400 dark:hover:bg-amber-950/40 w-fit">View Alerts</Button>
      </AlertDescription>
    </Alert>
  );
}
