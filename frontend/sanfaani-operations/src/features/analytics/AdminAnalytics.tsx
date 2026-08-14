import { useState } from 'react';
import type { ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Download } from 'lucide-react';
import { exportReport, useGetAnalyticsReport, type ExportReportDataset, type GetAnalyticsReportParams } from '@workspace/api-client-react';
import { toast } from 'sonner';

const money = (value: number) => `₦${value.toLocaleString('en-NG', { maximumFractionDigits: 0 })}`;
const today = new Date().toISOString().slice(0, 10);

export default function AdminAnalytics() {
  const [period, setPeriod] = useState<NonNullable<GetAnalyticsReportParams['period']>>('30-days');
  const [from, setFrom] = useState(today); const [to, setTo] = useState(today);
  const params = { period, ...(period === 'custom' ? { from, to } : {}) } satisfies GetAnalyticsReportParams;
  const report = useGetAnalyticsReport(params);
  const data = report.data;
  const moduleData = data ? [
    { module: 'Inventory', revenue: data.moduleRevenue.inventory }, { module: 'Charging', revenue: data.moduleRevenue.charging },
    { module: 'Workspace', revenue: data.moduleRevenue.workspace }, { module: 'Other', revenue: data.moduleRevenue.other },
  ] : [];
  const download = async (dataset: ExportReportDataset) => {
    try {
      const csv = await exportReport({ dataset, ...params });
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `sanfaani-${dataset}-${today}.csv`; anchor.click(); URL.revokeObjectURL(url);
    } catch { toast.error('The CSV report could not be exported.'); }
  };

  return <>
    <div className="mb-8 flex flex-col justify-between gap-5 xl:flex-row xl:items-end"><div><p className="font-mono text-[10px] uppercase tracking-[.22em] text-primary">Management reporting</p><h1 className="mt-2 font-serif text-4xl md:text-5xl">Analytics</h1><p className="mt-3 text-sm text-muted-foreground">Ledger-backed answers about income and operational demand.</p></div><div className="flex flex-wrap gap-2"><select value={period} onChange={(event) => setPeriod(event.target.value as typeof period)} className="h-11 rounded-md border border-input bg-card px-3 text-sm" data-testid="select-analytics-period"><option value="today">Today</option><option value="yesterday">Yesterday</option><option value="7-days">7 Days</option><option value="30-days">30 Days</option><option value="this-month">This Month</option><option value="custom">Custom Range</option></select>{period === 'custom' && <><input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} className="h-11 rounded-md border border-input bg-card px-3 text-sm" /><input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} className="h-11 rounded-md border border-input bg-card px-3 text-sm" /></>}</div></div>
    {report.isLoading && <div className="space-y-4">{[1, 2, 3].map((item) => <div key={item} className="h-28 animate-pulse rounded-lg bg-muted" />)}</div>}
    {report.isError && <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-6 text-destructive">The report could not be loaded. Check the selected dates and connection.</div>}
    {data && <>
      <p className="mb-5 font-mono text-[10px] text-muted-foreground">Business timezone: {data.range.timezone}</p>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6"><Metric label="Total income" value={money(data.revenue.income)} /><Metric label="Expenses" value={money(data.revenue.expenses)} /><Metric label="Net result" value={money(data.revenue.net)} tone={data.revenue.net >= 0 ? 'good' : 'bad'} /><Metric label="Stock sales" value={money(data.revenue.stockSales)} /><Metric label="Charging" value={money(data.revenue.charging)} /><Metric label="Workspace" value={money(data.revenue.workspace)} /></div>
      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <ChartCard title="How are income, expenses, and net changing each day?"><ResponsiveContainer width="100%" height={280}><LineChart data={data.revenueTrend}><CartesianGrid strokeDasharray="3 3" stroke="#334" /><XAxis dataKey="date" tick={{ fontSize: 10 }} /><YAxis tickFormatter={(value) => `₦${value / 1000}k`} tick={{ fontSize: 10 }} /><Tooltip formatter={(value) => money(Number(value))} /><Legend /><Line type="monotone" dataKey="income" stroke="#5cc7ac" strokeWidth={2} /><Line type="monotone" dataKey="expenses" stroke="#e15b54" strokeWidth={2} /><Line type="monotone" dataKey="net" stroke="#f4bd24" strokeWidth={2} /></LineChart></ResponsiveContainer></ChartCard>
        <ChartCard title="Which part of SANFAANI generates the most income?"><ResponsiveContainer width="100%" height={280}><BarChart data={moduleData}><CartesianGrid strokeDasharray="3 3" stroke="#334" /><XAxis dataKey="module" tick={{ fontSize: 10 }} /><YAxis tickFormatter={(value) => `₦${value / 1000}k`} tick={{ fontSize: 10 }} /><Tooltip formatter={(value) => money(Number(value))} /><Bar dataKey="revenue" fill="#f4bd24" /></BarChart></ResponsiveContainer></ChartCard>
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-3"><Section title="Charging demand"><MetricRow label="Peak check-in hour" value={data.charging.peakCheckInHour == null ? 'Not enough data' : `${String(data.charging.peakCheckInHour).padStart(2, '0')}:00`} /><MetricRow label="Average duration" value={`${data.charging.averageDurationMinutes} min`} /><MetricRow label="Ready → collection" value={`${data.charging.readyToCollectionMinutes} min`} /></Section><Section title="Workspace demand"><MetricRow label="Peak usage hour" value={data.workspace.peakUsageHour == null ? 'Not enough data' : `${String(data.workspace.peakUsageHour).padStart(2, '0')}:00`} /><MetricRow label="Visits" value={String(data.workspace.visitsPerDay.reduce((sum, item) => sum + item.visits, 0))} /><MetricRow label="Revenue" value={money(data.workspace.revenue)} /></Section><Section title="Customers & stock"><MetricRow label="Unique customers" value={String(data.customers.unique)} /><MetricRow label="Estimated stock value" value={money(data.inventory.estimatedValue)} /><MetricRow label="Stock-out events" value={String(data.inventory.stockOutFrequency)} /></Section></div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2"><Section title="Top-selling products">{data.inventory.topProducts.length ? <div className="divide-y divide-border">{data.inventory.topProducts.map((product) => <div key={product.productId} className="flex items-center justify-between gap-3 py-3 text-sm"><span>{product.name}</span><span className="font-mono text-xs">{product.quantity} sold · {money(product.revenue)}</span></div>)}</div> : <p className="text-sm text-muted-foreground">No sales in this period.</p>}</Section><Section title="Low-stock products">{data.inventory.lowStock.length ? <div className="divide-y divide-border">{data.inventory.lowStock.map((product) => <div key={product.id} className="flex items-center justify-between gap-3 py-3 text-sm"><span>{product.name}</span><span className="font-mono text-xs text-primary">{product.quantityOnHand} / reorder {product.reorderThreshold}</span></div>)}</div> : <p className="text-sm text-muted-foreground">No products are currently low on stock.</p>}</Section></div>
      <Section title="Export filtered operational data" className="mt-6"><div className="flex flex-wrap gap-2">{(['transactions', 'sales', 'charging', 'workspace'] as const).map((dataset) => <button key={dataset} onClick={() => void download(dataset)} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-border px-3 text-xs font-bold uppercase tracking-wider"><Download size={14} /> {dataset} CSV</button>)}</div></Section>
    </>}
  </>;
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) { return <section className="rounded-lg border border-border bg-card p-5"><p className="font-mono text-[9px] uppercase text-muted-foreground">{label}</p><p className={`mt-3 font-mono text-xl ${tone === 'good' ? 'text-secondary' : tone === 'bad' ? 'text-destructive' : ''}`}>{value}</p></section>; }
function ChartCard({ title, children }: { title: string; children: ReactNode }) { return <section className="rounded-lg border border-border bg-card p-5"><h2 className="mb-5 text-sm font-semibold">{title}</h2>{children}</section>; }
function Section({ title, children, className = '' }: { title: string; children: ReactNode; className?: string }) { return <section className={`rounded-lg border border-border bg-card p-5 ${className}`}><h2 className="mb-4 font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{title}</h2>{children}</section>; }
function MetricRow({ label, value }: { label: string; value: string }) { return <div className="flex justify-between gap-3 border-b border-border py-3 text-sm last:border-0"><span className="text-muted-foreground">{label}</span><strong>{value}</strong></div>; }
