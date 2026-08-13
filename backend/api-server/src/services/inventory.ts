import mongoose from 'mongoose';
import type { z } from 'zod';
import type { productInput, saleInput } from '../contracts.js';
import { ApiError } from '../lib/errors.js';
import { InventoryMovement, Product, Sale } from '../models/index.js';
import { audit } from './common.js';
import { generateReceipt, recordIncome } from './ledger.js';

export async function createProduct(input: z.infer<typeof productInput>, actorId: string) {
  const product = await Product.create(input);
  if (input.quantityOnHand > 0) await InventoryMovement.create({
    productId: product._id, previousQuantity: 0, quantity: input.quantityOnHand, newQuantity: input.quantityOnHand,
    type: 'opening', reason: 'Opening stock', createdBy: actorId,
  });
  await audit(actorId, 'PRODUCT_CREATED', 'product', product.id);
  return product;
}
export async function adjustStock(
  productId: string,
  quantity: number,
  type: 'restock' | 'write-off' | 'correction' | 'return' | 'other',
  reason: string,
  note: string | undefined,
  actorId: string,
) {
  const product = await Product.findOneAndUpdate(
    { _id: productId, quantityOnHand: { $gte: Math.max(0, -quantity) } },
    { $inc: { quantityOnHand: quantity } }, { new: true, runValidators: true },
  );
  if (!product) throw new ApiError(409, 'NEGATIVE_INVENTORY', 'This adjustment would reduce inventory below zero.');
  await InventoryMovement.create({
    productId, previousQuantity: product.quantityOnHand - quantity, quantity, newQuantity: product.quantityOnHand,
    type, reason, note, createdBy: actorId,
  });
  await audit(actorId, 'INVENTORY_ADJUSTED', 'product', productId, { quantity, type, reason, note });
  return product;
}
export async function createSale(input: z.infer<typeof saleInput>, actorId: string) {
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(async () => {
      const grouped = new Map<string, number>();
      for (const item of input.items) grouped.set(item.productId, (grouped.get(item.productId) ?? 0) + item.quantity);
      const saleItems: Array<{ productId: mongoose.Types.ObjectId; name: string; quantity: number; unitPrice: number; subtotal: number }> = [];
      for (const [productId, quantity] of grouped) {
        const product = await Product.findOneAndUpdate(
          { _id: productId, active: true, quantityOnHand: { $gte: quantity } },
          { $inc: { quantityOnHand: -quantity } }, { new: false, session },
        );
        if (!product) throw new ApiError(409, 'INSUFFICIENT_INVENTORY', 'One or more products do not have enough available stock.');
        saleItems.push({ productId: product._id, name: product.name, quantity, unitPrice: product.sellingPrice, subtotal: product.sellingPrice * quantity });
        await InventoryMovement.create([{
          productId, previousQuantity: product.quantityOnHand, quantity: -quantity, newQuantity: product.quantityOnHand - quantity,
          type: 'sale', reason: 'Stock sale', createdBy: actorId,
        }], { session });
      }
      const total = saleItems.reduce((sum, item) => sum + item.subtotal, 0);
      const [sale] = await Sale.create([{ customerId: input.customerId || undefined, items: saleItems, total, paymentMethod: input.paymentMethod }], { session });
      await recordIncome({
        type: 'stock_sale', amount: total, paymentMethod: input.paymentMethod,
        customerId: input.customerId ? new mongoose.Types.ObjectId(input.customerId) : undefined,
        referenceType: 'sale', referenceId: sale._id, description: `Sale of ${saleItems.length} item type(s)`, createdBy: actorId,
      }, session);
      const receipt = await generateReceipt({
        type: 'sale', customerId: input.customerId ? new mongoose.Types.ObjectId(input.customerId) : undefined,
        referenceId: sale._id, total, paymentMethod: input.paymentMethod, details: { items: saleItems },
      }, session);
      await audit(actorId, 'SALE_CREATED', 'sale', sale.id, { total }, session);
      return { sale, receipt };
    });
  } finally { await session.endSession(); }
}
