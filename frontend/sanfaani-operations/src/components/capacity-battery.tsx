export interface CapacityBatteryProps {
  current: number;
  maximum: number;
  label?: string;
  showRemaining?: boolean;
}

export type CapacityState = 'healthy' | 'busy' | 'warning' | 'full' | 'unavailable';

export function getCapacityState(current: number, maximum: number): CapacityState {
  if (maximum <= 0) return 'unavailable';
  const percentage = Math.max(0, Math.min(100, (current / maximum) * 100));
  if (percentage >= 100) return 'full';
  if (percentage >= 86) return 'warning';
  if (percentage >= 61) return 'busy';
  return 'healthy';
}

export function CapacityBattery({ current, maximum, label = 'Capacity', showRemaining = true }: CapacityBatteryProps) {
  const percentage = maximum > 0 ? Math.max(0, Math.min(100, Math.round((current / maximum) * 100))) : 0;
  const remaining = Math.max(0, maximum - current);
  const state = getCapacityState(current, maximum);
  const presentation: Record<CapacityState, { text: string; bar: string }> = {
    healthy: { text: 'Healthy', bar: 'bg-[#5cc7ac]' },
    busy: { text: 'Busy', bar: 'bg-primary' },
    warning: { text: 'Nearly full', bar: 'bg-[#e28b3c]' },
    full: { text: 'Full', bar: 'bg-destructive' },
    unavailable: { text: 'Capacity unavailable', bar: 'bg-muted-foreground' },
  };
  const display = presentation[state];

  return <div data-testid={`capacity-${label.toLowerCase().replace(/\s+/g, '-')}`}>
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
      <span>{label}</span>
      <span className="font-mono text-muted-foreground">{current} / {maximum} occupied</span>
    </div>
    <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true"><div className={`h-full rounded-full transition-[width] ${display.bar}`} style={{ width: `${percentage}%` }} /></div>
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
      <span>{display.text} · {percentage}% in use</span>
      {showRemaining && <span>{remaining} {remaining === 1 ? 'slot' : 'slots'} available</span>}
    </div>
  </div>;
}
