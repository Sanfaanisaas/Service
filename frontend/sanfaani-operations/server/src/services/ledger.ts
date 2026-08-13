import type { ClientSession, Types } from 'mongoose';
import type { PaymentMethod } from '../../../shared/contracts.js';
import { Receipt, Transaction } from '../models/index.js';
import { receiptNumber } from '../lib/ids.js';

export async function recordIncome(input: {
  type: 'stock_sale'|'charging_fee'|'workspace_fee'; amount: number; paymentMethod: PaymentMethod;
  customerId?: Types.ObjectId; referenceType: string; referenceId: Types.ObjectId; description: string; createdBy: string;
}, session?: ClientSession) {
  const [transaction] = await Transaction.create([{ ...input, direction: 'income' }], { session });
  return transaction;
}
export async function generateReceipt(input: {
  type: 'sale'|'charging'|'workspace'; customerId?: Types.ObjectId; customerName?: string;
  referenceId: Types.ObjectId; claimId?: string; total: number; paymentMethod: PaymentMethod; details?: Record<string, unknown>;
}, session?: ClientSession) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const [receipt] = await Receipt.create([{ ...input, receiptNumber: receiptNumber(), subtotal: input.total, generatedAt: new Date() }], { session });
      return receipt;
    } catch (error) {
      if ((error as { code?: number }).code !== 11000 || attempt === 4) throw error;
    }
  }
  throw new Error('Receipt generation failed.');
}
