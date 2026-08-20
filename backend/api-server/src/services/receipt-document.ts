import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import QRCode from 'qrcode';

import { ApiError } from '../lib/errors.js';
import {
  ChargingSession,
  Customer,
  Receipt,
  Setting,
} from '../models/index.js';

function printable(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';

  return String(value)
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '?');
}

function money(value: unknown, currency = 'NGN'): string {
  const amount = Number(value ?? 0);
  return `${currency} ${Number.isFinite(amount) ? amount.toLocaleString('en-NG') : '0'}`;
}

export async function createReceiptPdf(
  receiptId: string,
): Promise<Buffer> {
  const receipt = await Receipt.findById(receiptId);

  if (!receipt) {
    throw new ApiError(404, 'RECEIPT_NOT_FOUND', 'Receipt not found.');
  }

  const customer = receipt.customerId
    ? await Customer.findById(receipt.customerId)
    : null;

  const business = await Setting.findOne({ key: 'business' });

  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([595.28, 841.89]);

  const currency = printable(business?.currency || 'NGN');
  let y = 790;

  const line = (
    label: string,
    value: unknown,
    options: { bold?: boolean; size?: number } = {},
  ) => {
    page.drawText(printable(`${label}: ${printable(value)}`), {
      x: 55,
      y,
      size: options.size ?? 10,
      font: options.bold ? bold : regular,
      color: rgb(0.08, 0.1, 0.12),
    });

    y -= 20;
  };

  page.drawText(printable(business?.businessName || 'SANFAANI'), {
    x: 55,
    y,
    size: 24,
    font: bold,
    color: rgb(0.08, 0.1, 0.12),
  });

  y -= 28;

  page.drawText('RECEIPT', {
    x: 55,
    y,
    size: 11,
    font: bold,
    color: rgb(0.65, 0.45, 0.05),
  });

  y -= 32;

  line('Receipt', receipt.receiptNumber, { bold: true });
  line('Type', String(receipt.type).toUpperCase());
  line('Customer', receipt.customerName || customer?.name || 'Walk-in');
  line(
    'Date',
    receipt.generatedAt
      ? new Date(receipt.generatedAt).toLocaleString('en-NG')
      : new Date().toLocaleString('en-NG'),
  );
  line('Payment', receipt.paymentMethod);
  line('Operational reference', receipt.referenceId);
  line('Subtotal', money(receipt.subtotal, currency));
  line('Total', money(receipt.total, currency), { bold: true });

  if (receipt.type === 'charging') {
    const charging = await ChargingSession.findById(
      receipt.referenceId,
    ).select('+secureClaimToken');

    y -= 10;

    line('Claim ID', receipt.claimId || charging?.publicSessionId || '-', {
      bold: true,
    });

    if (charging) {
      line('Bay', charging.slotNumber);

      const device = [
        charging.device?.brand,
        charging.device?.model,
        charging.device?.type,
      ]
        .filter(Boolean)
        .join(' ');

      line('Device', device || 'Device');
    }

    const secureToken = charging?.secureClaimToken;

    if (secureToken) {
      const qrDataUrl = await QRCode.toDataURL(
        `sanfaani://claim/${secureToken}`,
        {
          width: 240,
          margin: 1,
          errorCorrectionLevel: 'M',
        },
      );

      const base64 = qrDataUrl.split(',')[1];

      if (base64) {
        const qr = await pdf.embedPng(
          Buffer.from(base64, 'base64'),
        );

        const size = 145;

        page.drawImage(qr, {
          x: 55,
          y: Math.max(90, y - size - 8),
          width: size,
          height: size,
        });

        page.drawText('Present this QR when collecting the device.', {
          x: 215,
          y: Math.max(155, y - 75),
          size: 10,
          font: bold,
          color: rgb(0.08, 0.1, 0.12),
        });

        page.drawText(
          'The secure claim is valid for one collection only.',
          {
            x: 215,
            y: Math.max(137, y - 93),
            size: 9,
            font: regular,
            color: rgb(0.35, 0.38, 0.42),
          },
        );
      }
    }
  }

  if (business?.receiptFooter) {
    page.drawText(printable(business.receiptFooter), {
      x: 55,
      y: 45,
      size: 8,
      font: regular,
      color: rgb(0.4, 0.42, 0.45),
      maxWidth: 485,
    });
  }

  return Buffer.from(await pdf.save());
}
