import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetCustomerMeQueryKey, useGetCustomerMe, useGetCustomerMyCharging,
  useGetCustomerMyReceipts, useGetCustomerMyWorkspace, useUpdateCustomerMe,
} from '@workspace/api-client-react';
import { Link } from 'wouter';
import { toast } from 'sonner';
import NotificationControl from '@/features/notifications/NotificationControl';

const validPhone = /^\+?[0-9][0-9\s-]{6,23}$/;
const date = (value: string) => new Date(value).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });

export default function CustomerProfile() {
  const profile = useGetCustomerMe({ query: { queryKey: getGetCustomerMeQueryKey() } });
  const charging = useGetCustomerMyCharging({ view: 'history' });
  const workspace = useGetCustomerMyWorkspace();
  const receipts = useGetCustomerMyReceipts();
  const update = useUpdateCustomerMe();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: '', phone: '', inApp: true, chargingReminders: true, workspaceAvailability: false, whatsappOptIn: false });
  useEffect(() => {
    if (!profile.data) return;
    setForm({
      name: profile.data.name, phone: profile.data.phone ?? '', inApp: profile.data.notificationPreferences.inApp,
      chargingReminders: profile.data.notificationPreferences.chargingReminders,
      workspaceAvailability: profile.data.notificationPreferences.workspaceAvailability,
      whatsappOptIn: profile.data.whatsappOptIn,
    });
  }, [profile.data]);

  if (profile.isLoading) return <div className="h-80 animate-pulse rounded-lg bg-muted" />;
  if (profile.isError || !profile.data) return <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-6 text-destructive">Your profile could not be loaded.</div>;
  const sessions = charging.data?.recentSessions ?? [];
  const receiptByReference = new Map(receipts.data?.map((receipt) => [receipt.referenceId, receipt]));
  const save = () => update.mutate({ data: {
    name: form.name.trim(), phone: form.phone.trim(), whatsappOptIn: form.whatsappOptIn,
    notificationPreferences: { inApp: form.inApp, chargingReminders: form.chargingReminders, workspaceAvailability: form.workspaceAvailability },
  } }, { onSuccess: () => { void queryClient.invalidateQueries({ queryKey: getGetCustomerMeQueryKey() }); toast.success('Profile and preferences saved.'); }, onError: () => toast.error('Profile could not be saved. Check the phone number and try again.') });

  return <>
    <div className="mb-8"><p className="font-mono text-[10px] uppercase tracking-[.22em] text-primary">Your account</p><h1 className="mt-2 font-serif text-4xl md:text-5xl">Profile & preferences</h1><p className="mt-3 text-sm text-muted-foreground">Control each communication channel independently.</p></div>
    <div className="grid gap-6 lg:grid-cols-[1.15fr_.85fr]">
      <section className="rounded-lg border border-border bg-card p-6">
        <h2 className="font-semibold">Profile</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Name<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="mt-2 h-11 w-full rounded-md border border-input bg-muted/50 px-3 text-sm text-foreground" /></label>
          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Phone<input type="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} className="mt-2 h-11 w-full rounded-md border border-input bg-muted/50 px-3 text-sm text-foreground" aria-invalid={Boolean(form.phone && !validPhone.test(form.phone))} /></label>
          <div><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Email</p><p className="mt-2 min-h-11 rounded-md bg-muted/30 px-3 py-3 text-sm">{profile.data.email ?? 'Not provided'}</p><p className="mt-1 text-[10px] text-muted-foreground">Managed by your secure sign-in account.</p></div>
          <div><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Account status</p><p className="mt-2 min-h-11 rounded-md bg-muted/30 px-3 py-3 text-sm capitalize text-secondary">{profile.data.accountStatus ?? 'active'}</p></div>
        </div>
        <div className="mt-7 space-y-3 border-t border-border pt-6">
          <Preference label="Charging reminders" help="In-app reminders about your charging session." checked={form.chargingReminders} onChange={(value) => setForm({ ...form, chargingReminders: value })} />
          <Preference label="In-app notifications" help="Show notifications inside your customer portal." checked={form.inApp} onChange={(value) => setForm({ ...form, inApp: value })} />
          <Preference label="Workspace availability" help="Tell me when a place becomes available, with a six-hour cooldown." checked={form.workspaceAvailability} onChange={(value) => setForm({ ...form, workspaceAvailability: value })} />
          <Preference label="WhatsApp consent" help="Consent to WhatsApp-related invitations and updates." checked={form.whatsappOptIn} onChange={(value) => setForm({ ...form, whatsappOptIn: value })} />
        </div>
        <button onClick={save} disabled={update.isPending || form.name.trim().length < 2 || !validPhone.test(form.phone)} className="mt-6 min-h-11 rounded-md bg-primary px-5 text-xs font-bold uppercase tracking-wider text-primary-foreground disabled:opacity-50" data-testid="button-save-profile">{update.isPending ? 'Saving…' : 'Save profile'}</button>
      </section>
      <div className="space-y-6">
        <NotificationControl />
        <section className="rounded-lg border border-border bg-card p-6"><h2 className="font-semibold">Your history</h2><div className="mt-5 grid grid-cols-3 gap-3 text-center"><Metric label="Charging" value={sessions.length} /><Metric label="Workspace" value={workspace.data?.length ?? 0} /><Metric label="Receipts" value={receipts.data?.length ?? 0} /></div></section>
      </div>
    </div>
    <section className="mt-6 rounded-lg border border-border bg-card p-6"><h2 className="font-semibold">Recent devices</h2>{sessions.length ? <div className="mt-4 divide-y divide-border">{sessions.slice(0, 10).map((session) => { const receipt = receiptByReference.get(session.id); return <div key={session.id} className="flex flex-wrap items-center gap-4 py-4 text-sm"><div className="min-w-[180px] flex-1"><p className="font-semibold">{[session.device.brand, session.device.model, session.device.type].filter(Boolean).join(' · ')}</p><p className="mt-1 text-xs text-muted-foreground">{date(session.timeIn)} · Bay B-{String(session.slotNumber).padStart(2, '0')}</p></div><span className="rounded bg-muted px-2 py-1 font-mono text-[10px] uppercase">{session.status}</span>{receipt && <Link href={`/customer/receipts/${receipt.id}`} className="text-xs font-semibold text-primary hover:underline">Receipt</Link>}</div>; })}</div> : <p className="mt-4 text-sm text-muted-foreground">No charging history yet.</p>}</section>
  </>;
}

function Preference({ label, help, checked, onChange }: { label: string; help: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="flex cursor-pointer items-start justify-between gap-5 rounded-md bg-muted/30 p-4"><span><strong className="block text-sm">{label}</strong><span className="mt-1 block text-xs text-muted-foreground">{help}</span></span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-1 h-4 w-4 accent-[hsl(var(--primary))]" /></label>;
}
function Metric({ label, value }: { label: string; value: number }) { return <div className="rounded-md bg-muted/30 p-3"><p className="font-mono text-xl">{value}</p><p className="mt-1 text-[10px] uppercase text-muted-foreground">{label}</p></div>; }
