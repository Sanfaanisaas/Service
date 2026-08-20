import { useEffect, useState } from 'react';
import { Download, MessageCircle, Printer, ReceiptText } from 'lucide-react';
import {
  getGetReceiptDetailQueryKey,
  getGetReceiptDeliveryQueryKey,
  useGetReceiptDetail,
  useGetReceiptDelivery,
  useSendReceiptWhatsApp,
  type Receipt,
  type ReceiptDelivery,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { toast } from 'sonner';

const money = (value: number) => `₦${value.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
const dateTime = (value: string) => new Date(value).toLocaleString('en-NG', { dateStyle: 'long', timeStyle: 'short' });
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value : '—';

function deviceLabel(receipt: Receipt) {
  const device = receipt.details?.device;
  if (!device || typeof device !== 'object') return '—';
  const value = device as Record<string, unknown>;
  return [value.brand, value.model, value.type, value.color].filter((part) => typeof part === 'string' && part).join(' · ') || '—';
}

function QrClaim({ token }: { token: string }) {
  const [source, setSource] = useState('');
  useEffect(() => {
    let current = true;
    void import('qrcode').then(({ default: QRCode }) => QRCode.toDataURL(`sanfaani://claim/${token}`, {
      errorCorrectionLevel: 'H', margin: 2, width: 240, color: { dark: '#10151a', light: '#ffffff' },
    })).then((dataUrl) => { if (current) setSource(dataUrl); }).catch(() => toast.error('The secure claim QR could not be rendered.'));
    return () => { current = false; };
  }, [token]);
  return source ? <img src={source} width={180} height={180} alt="Secure charging collection QR code" className="mx-auto rounded bg-white p-2" /> : <div className="mx-auto h-[180px] w-[180px] animate-pulse rounded bg-muted" />;
}

async function downloadPdf(receipt: Receipt) {
  const [{ jsPDF }, { default: QRCode }] = await Promise.all([import('jspdf'), import('qrcode')]);
  const document = new jsPDF({ unit: 'mm', format: 'a5' });
  document.setFillColor(16, 21, 26);
  document.rect(0, 0, 148, 32, 'F');
  document.setTextColor(246, 240, 222);
  document.setFont('helvetica', 'bold');
  document.setFontSize(20);
  document.text('SANFAANI', 14, 15);
  document.setFontSize(9);
  document.text('CUSTOMER RECEIPT', 14, 23);
  document.setTextColor(16, 21, 26);
  document.setFont('helvetica', 'normal');
  document.setFontSize(10);
  const rows: Array<[string, string]> = [
    ['Receipt number', receipt.receiptNumber], ['Receipt type', receipt.type.toUpperCase()],
    ['Customer', receipt.customerName ?? 'Walk-in'], ['Date / time', dateTime(receipt.generatedAt)],
    ['Payment method', receipt.paymentMethod], ['Operational reference', receipt.referenceId ?? '—'],
    ['Subtotal', money(receipt.subtotal)], ['Total', money(receipt.total)],
  ];
  if (receipt.claimId) rows.splice(6, 0, ['Claim ID', receipt.claimId]);
  if (receipt.type === 'charging') {
    rows.splice(6, 0, ['Device', deviceLabel(receipt)], ['Charging slot', `B-${String(receipt.details?.slotNumber ?? '—').padStart(2, '0')}`]);
  }
  let y = 43;
  rows.forEach(([label, value]) => {
    document.setTextColor(100, 100, 100); document.setFontSize(8); document.text(label.toUpperCase(), 14, y);
    document.setTextColor(16, 21, 26); document.setFontSize(10); document.text(value, 55, y); y += 9;
  });
  if (receipt.claimToken) {
    const qr = await QRCode.toDataURL(`sanfaani://claim/${receipt.claimToken}`, { errorCorrectionLevel: 'H', margin: 1, width: 320 });
    document.addImage(qr, 'PNG', 94, Math.min(y + 2, 145), 38, 38);
    document.setFontSize(7); document.text('Secure one-time collection claim', 94, Math.min(y + 43, 188));
  }
  document.setDrawColor(230, 180, 25); document.line(14, 194, 134, 194);
  document.setFontSize(8); document.setTextColor(90, 90, 90); document.text('Thank you for choosing SANFAANI.', 14, 201);
  document.save(`SANFAANI-Receipt-${receipt.receiptNumber}.pdf`);
}

export default function ReceiptDetailPage({ params }: { params?: { receiptId?: string } }) {
  const receiptId = params?.receiptId ?? '';
  const queryClient = useQueryClient();
  const query = useGetReceiptDetail(receiptId, { query: { enabled: Boolean(receiptId), queryKey: getGetReceiptDetailQueryKey(receiptId) } });
  const receipt = query.data;
  const back = '/admin/receipts';
  const deliveryQuery = useGetReceiptDelivery(receiptId, { query: { enabled: Boolean(receiptId), queryKey: getGetReceiptDeliveryQueryKey(receiptId), refetchInterval: (queryState) => {
    const current = queryState.state.data as ReceiptDelivery | null | undefined;
    return current?.status === 'pending' || current?.status === 'processing' ? 15_000 : false;
  } } });
  const sendWhatsApp = useSendReceiptWhatsApp({
    mutation: {
      onSuccess: async () => {
        toast.success('WhatsApp receipt delivery queued.');
        await queryClient.invalidateQueries({ queryKey: getGetReceiptDeliveryQueryKey(receiptId) });
      },
      onError: () => toast.error('WhatsApp receipt could not be queued.'),
    },
  });
  const delivery = deliveryQuery.data;
  const deliveryLoading = deliveryQuery.isLoading || deliveryQuery.isFetching || sendWhatsApp.isPending;

  if (query.isLoading) return <div className="mx-auto max-w-3xl animate-pulse rounded-lg bg-muted p-16" data-testid="receipt-loading" />;
  if (query.isError || !receipt) return <div className="mx-auto max-w-3xl rounded-lg border border-destructive/40 bg-destructive/10 p-8 text-destructive">This receipt is unavailable or you do not have permission to view it. <Link href={back} className="underline">Return to receipts</Link></div>;

  return <div>
    <div className="receipt-actions mx-auto mb-5 flex max-w-3xl flex-wrap items-center justify-between gap-3">
      <Link href={back} className="text-sm text-muted-foreground hover:text-foreground">← Back to receipts</Link>
      <div className="flex gap-2">
        <button onClick={() => window.print()} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border px-4 text-xs font-bold uppercase tracking-wider"><Printer size={15} /> Print</button><button type="button" disabled={deliveryLoading || delivery?.status === 'sent' || delivery?.status === 'processing'} onClick={() => sendWhatsApp.mutate({ id: receiptId })} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border px-4 text-xs font-bold uppercase tracking-wider disabled:opacity-50" data-testid="button-send-whatsapp"><MessageCircle size={15} />{delivery?.status === 'sent' ? 'WhatsApp sent' : delivery?.status === 'failed' ? 'Retry WhatsApp' : delivery?.status === 'pending' || delivery?.status === 'processing' ? 'WhatsApp pending' : 'Send WhatsApp'}</button>
        <button onClick={() => void downloadPdf(receipt).catch(() => toast.error('The receipt PDF could not be created.'))} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-primary px-4 text-xs font-bold uppercase tracking-wider text-primary-foreground" data-testid="button-download-pdf"><Download size={15} /> Download PDF</button>
      </div>
    </div>
    <article className="receipt-print mx-auto max-w-3xl overflow-hidden rounded-lg bg-white text-[#10151a] shadow-xl" aria-label={`Receipt ${receipt.receiptNumber}`}>
      <header className="flex items-start justify-between bg-[#10151a] p-7 text-[#f6f0de] md:p-10"><div><p className="text-xl font-bold tracking-[.22em]">SANFAANI</p><p className="mt-2 text-xs uppercase tracking-widest text-[#f4bd24]">Customer receipt</p></div><ReceiptText className="text-[#f4bd24]" /></header>
      <div className="p-7 md:p-10">
        <div className="grid gap-4 sm:grid-cols-2">
          <Item label="Receipt number" value={receipt.receiptNumber} />
          <Item label="Receipt type" value={receipt.type} />
          <Item label="Customer" value={receipt.customerName ?? 'Walk-in'} />
          <Item label="Date / time" value={dateTime(receipt.generatedAt)} />
          <Item label="Payment method" value={receipt.paymentMethod} />
          <Item label="Operational reference" value={receipt.referenceId ?? '—'} />
          {receipt.claimId && <Item label="Claim ID" value={receipt.claimId} />}
          {receipt.type === 'charging' && <><Item label="Device" value={deviceLabel(receipt)} /><Item label="Charging slot" value={`B-${String(receipt.details?.slotNumber ?? '—').padStart(2, '0')}`} /></>}
        </div>
        <div className="mt-8 border-y border-[#d8d8d8] py-5"><div className="flex justify-between text-sm"><span>Subtotal</span><strong>{money(receipt.subtotal)}</strong></div><div className="mt-4 flex justify-between text-xl"><span>Total</span><strong>{money(receipt.total)}</strong></div></div>
        {receipt.claimToken && <section className="mt-8 text-center"><QrClaim token={receipt.claimToken} /><h2 className="mt-3 font-bold">Secure collection claim</h2><p className="mx-auto mt-1 max-w-sm text-xs text-[#555]">Staff will scan this one-time credential before releasing the device. Keep it private.</p></section>}
        <p className="mt-8 border-t border-[#e4e4e4] pt-5 text-center text-xs text-[#666]">Thank you for choosing SANFAANI.</p>
      </div>
    </article>
  </div>;
}

function Item({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[10px] font-bold uppercase tracking-wider text-[#666]">{label}</p><p className="mt-1 break-words text-sm font-semibold capitalize">{text(value)}</p></div>;
}
