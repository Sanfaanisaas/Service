import { parsePhoneNumberFromString } from 'libphonenumber-js';

export function normalizeWhatsAppPhone(value: string) {
    const phone = parsePhoneNumberFromString(value, 'NG');

    if (!phone?.isValid()) {
        throw new Error('INVALID_WHATSAPP_PHONE');
    }

    return phone.number;
}

export function normalizeWhatsAppPhone(phone: string): string

export async function enqueueReceiptWhatsApp(
    receiptId: string,
): Promise<void>

export async function processReceiptDelivery(
    deliveryId: string,
): Promise<void>

export async function processPendingReceiptDeliveries(): Promise<void>