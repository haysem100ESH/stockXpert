import { Progress } from '@/components/ui/progress';

interface DebtProgressBarProps {
  currentDebt: number;
  maxCreditLimit: number;
}

export default function DebtProgressBar({ currentDebt, maxCreditLimit }: DebtProgressBarProps) {
  if (maxCreditLimit <= 0) {
    return (
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Credit Limit</span>
          <span className="font-medium text-destructive">Cash Only</span>
        </div>
        <Progress value={100} className="h-2 [&>div]:bg-destructive" />
      </div>
    );
  }

  const usedPercent = Math.min(100, (currentDebt / maxCreditLimit) * 100);
  const available = Math.max(0, maxCreditLimit - currentDebt);
  const barColor = usedPercent >= 90 ? '[&>div]:bg-destructive' : usedPercent >= 70 ? '[&>div]:bg-orange-500' : usedPercent >= 50 ? '[&>div]:bg-yellow-500' : '';

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>Used ETB {currentDebt.toFixed(0)} of {maxCreditLimit.toFixed(0)}</span>
        <span className="font-medium">ETB {available.toFixed(0)} available</span>
      </div>
      <Progress value={usedPercent} className={`h-2 ${barColor}`} />
    </div>
  );
}
