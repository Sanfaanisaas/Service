import { parsePhoneNumberFromString } from 'libphonenumber-js';

import { env } from '../config/env.js';
import {
  Customer,
  Receipt,
  ReceiptDelivery,
} from '../models/index.js';
import { createReceiptPdf } from './receipt-document.js';

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 60_000;
const STALE_PROCESSING_MS = 5 * 60_000;

type GraphErrorBody = {
  error?: {
    code?: number;
    error_subcode?: number;
    message?: string;
    type?: string;
  };
};

type MediaUploadResponse = GraphErrorBody & {
  id?: string;
};

type SendMessageResponse = GraphErrorBody & {
  messages?: Array<{ id?: string }>;
};

function errorCode(error: unknown): string {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
  ) {
    return (error as { code: string }).code;
  }

  if (error instanceof Error && error.message) {
    return error.message.slice(0, 120);
  }

  return 'WHATSAPP_DELIVERY_FAILED';
}

function configuration() {
  const values = {
    version: env.WHATSAPP_GRAPH_API_VERSION,
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
    accessToken: env.WHATSAPP_ACCESS_TOKEN,
    templateName: env.WHATSAPP_RECEIPT_TEMPLATE_NAME,
    language: env.WHATSAPP_RECEIPT_TEMPLATE_LANGUAGE,
  };

  if (
    !values.version ||
    !values.phoneNumberId ||
    !values.accessToken ||
    !values.templateName ||
    !values.language
  ) {
    const error = new Error('WHATSAPP_NOT_CONFIGURED') as Error & {
      code?: string;
    };

    error.code = 'WHATSAPP_NOT_CONFIGURED';
    throw error;
  }

  return values;
}

async function graphJson<T>(
  url: string,
  init: RequestInit,
): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json() as T & GraphErrorBody;

  if (!response.ok) {
    const code = payload.error?.code
      ? `WHATSAPP_GRAPH_${payload.error.code}`
      : 'WHATSAPP_GRAPH_REQUEST_FAILED';

    const error = new Error(code) as Error & { code?: string };
    error.code = code;
    throw error;
  }

  return payload;
}

async function uploadReceiptPdf(
  receiptNumber: string,
  pdf: Buffer,
): Promise<string> {
  const config = configuration();
  const form = new FormData();

  form.append('messaging_product', 'whatsapp');
  form.append(
    'file',
    new Blob([new Uint8Array(pdf)], {
      type: 'application/pdf',
    }),
    `SANFAANI-${receiptNumber}.pdf`,
  );

  const payload = await graphJson<MediaUploadResponse>(
    `https://graph.facebook.com/${config.version}/${config.phoneNumberId}/media`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
      },
      body: form,
    },
  );

  if (!payload.id) {
    const error = new Error('WHATSAPP_MEDIA_ID_MISSING') as Error & {
      code?: string;
    };

    error.code = 'WHATSAPP_MEDIA_ID_MISSING';
    throw error;
  }

  return payload.id;
}

async function sendReceiptTemplate(input: {
  to: string;
  mediaId: string;
  receiptNumber: string;
  customerName: string;
  receiptType: string;
  total: number;
}): Promise<string> {
  const config = configuration();

  const payload = await graphJson<SendMessageResponse>(
    `https://graph.facebook.com/${config.version}/${config.phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: input.to.replace(/^\+/, ''),
        type: 'template',
        template: {
          name: config.templateName,
          language: {
            code: config.language,
          },
          components: [
            {
              type: 'header',
              parameters: [
                {
                  type: 'document',
                  document: {
                    id: input.mediaId,
                    filename: `SANFAANI-${input.receiptNumber}.pdf`,
                  },
                },
              ],
            },
            {
              type: 'body',
              parameters: [
                { type: 'text', text: input.customerName },
                { type: 'text', text: input.receiptNumber },
                { type: 'text', text: input.receiptType },
                {
                  type: 'text',
                  text: `NGN ${input.total.toLocaleString('en-NG')}`,
                },
              ],
            },
          ],
        },
      }),
    },
  );

  const providerMessageId = payload.messages?.[0]?.id;

  if (!providerMessageId) {
    const error = new Error('WHATSAPP_MESSAGE_ID_MISSING') as Error & {
      code?: string;
    };

    error.code = 'WHATSAPP_MESSAGE_ID_MISSING';
    throw error;
  }

  return providerMessageId;
}

export function normalizeWhatsAppPhone(value: string): string {
  const phone = parsePhoneNumberFromString(value, 'NG');

  if (!phone?.isValid()) {
    const error = new Error('INVALID_WHATSAPP_PHONE') as Error & {
      code?: string;
    };

    error.code = 'INVALID_WHATSAPP_PHONE';
    throw error;
  }

  return phone.number;
}

export async function enqueueReceiptWhatsApp(
  receiptId: string,
): Promise<void> {
  const receipt = await Receipt.findById(receiptId);

  if (!receipt?.customerId) return;

  const customer = await Customer.findById(receipt.customerId);

  if (
    !customer ||
    customer.whatsappOptIn !== true ||
    !customer.phone
  ) {
    return;
  }

  let destination: string;

  try {
    destination = normalizeWhatsAppPhone(customer.phone);
  } catch (error) {
    await ReceiptDelivery.findOneAndUpdate(
      {
        receiptId: receipt._id,
        channel: 'whatsapp',
      },
      {
        $setOnInsert: {
          receiptId: receipt._id,
          customerId: customer._id,
          channel: 'whatsapp',
          destination: customer.phone,
          attempts: 0,
        },
        $set: {
          status: 'failed',
          lastErrorCode: errorCode(error),
          lastAttemptAt: new Date(),
        },
      },
      {
        upsert: true,
        new: true,
      },
    );

    return;
  }

  const existing = await ReceiptDelivery.findOne({
    receiptId: receipt._id,
    channel: 'whatsapp',
  });

  if (
    existing &&
    ['sent', 'pending', 'processing'].includes(existing.status)
  ) {
    return;
  }

  if (existing) {
    if (existing.attempts >= MAX_ATTEMPTS) return;

    existing.destination = destination;
    existing.status = 'pending';
    existing.lastErrorCode = undefined;
    await existing.save();
    return;
  }

  await ReceiptDelivery.create({
    receiptId: receipt._id,
    customerId: customer._id,
    channel: 'whatsapp',
    destination,
    status: 'pending',
    attempts: 0,
  });
}

export async function processReceiptDelivery(
  deliveryId: string,
): Promise<void> {
  if (!env.WHATSAPP_ENABLED) return;

  const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS);
  const delivery = await ReceiptDelivery.findOneAndUpdate(
    {
      _id: deliveryId,
      $or: [
        {
          status: {
            $in: ['pending', 'failed'],
          },
        },
        {
          status: 'processing',
          lastAttemptAt: {
            $lte: staleBefore,
          },
        },
      ],
      attempts: {
        $lt: MAX_ATTEMPTS,
      },
    },
    {
      $set: {
        status: 'processing',
        lastAttemptAt: new Date(),
      },
      $inc: {
        attempts: 1,
      },
    },
    {
      new: true,
    },
  );

  if (!delivery) return;

  try {
    const receipt = await Receipt.findById(delivery.receiptId);

    if (!receipt) {
      throw Object.assign(new Error('RECEIPT_NOT_FOUND'), {
        code: 'RECEIPT_NOT_FOUND',
      });
    }

    const customer = await Customer.findById(delivery.customerId);

    if (!customer) {
      throw Object.assign(new Error('CUSTOMER_NOT_FOUND'), {
        code: 'CUSTOMER_NOT_FOUND',
      });
    }

    if (
      customer.whatsappOptIn !== true ||
      !customer.phone
    ) {
      throw Object.assign(new Error('WHATSAPP_CONSENT_MISSING'), {
        code: 'WHATSAPP_CONSENT_MISSING',
      });
    }

    const normalized = normalizeWhatsAppPhone(customer.phone);

    delivery.destination = normalized;
    await delivery.save();

    const pdf = await createReceiptPdf(receipt.id);

    const mediaId = await uploadReceiptPdf(
      receipt.receiptNumber,
      pdf,
    );

    const providerMessageId = await sendReceiptTemplate({
      to: normalized,
      mediaId,
      receiptNumber: receipt.receiptNumber,
      customerName:
        receipt.customerName ||
        customer.name ||
        'Customer',
      receiptType: receipt.type,
      total: receipt.total,
    });

    await ReceiptDelivery.updateOne(
      {
        _id: delivery._id,
      },
      {
        $set: {
          status: 'sent',
          destination: normalized,
          providerMessageId,
          sentAt: new Date(),
          lastAttemptAt: new Date(),
        },
        $unset: {
          lastErrorCode: 1,
        },
      },
    );
  } catch (error) {
    await ReceiptDelivery.updateOne(
      {
        _id: delivery._id,
      },
      {
        $set: {
          status: 'failed',
          lastErrorCode: errorCode(error),
          lastAttemptAt: new Date(),
        },
      },
    );

    throw error;
  }
}

export async function processPendingReceiptDeliveries(): Promise<void> {
  if (!env.WHATSAPP_ENABLED) return;

  const retryBefore = new Date(Date.now() - RETRY_DELAY_MS);
  const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS);

  const deliveries = await ReceiptDelivery.find({
    attempts: {
      $lt: MAX_ATTEMPTS,
    },
    $or: [
      {
        status: 'pending',
        $or: [
          {
            lastAttemptAt: {
              $exists: false,
            },
          },
          {
            lastAttemptAt: null,
          },
          {
            lastAttemptAt: {
              $lte: retryBefore,
            },
          },
        ],
      },
      {
        status: 'failed',
        lastAttemptAt: {
          $lte: retryBefore,
        },
      },
      {
        status: 'processing',
        lastAttemptAt: {
          $lte: staleBefore,
        },
      },
    ],
  })
    .sort({
      createdAt: 1,
    })
    .limit(10);

  for (const delivery of deliveries) {
    try {
      await processReceiptDelivery(delivery.id);
    } catch {
      // Failure is already stored on the delivery record.
    }
  }
}
