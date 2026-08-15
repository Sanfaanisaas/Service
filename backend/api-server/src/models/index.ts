import mongoose, { Schema } from 'mongoose';

const options = {
  timestamps: true,
  toJSON: { virtuals: true, versionKey: false, transform: (_doc: unknown, ret: Record<string, unknown>) => { delete ret._id; } },
};
const money = { type: Number, required: true, min: 0 };

const appUserSchema = new Schema({
  supabaseUserId: { type: String, required: true, unique: true, index: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  name: String, role: { type: String, enum: ['admin', 'staff', 'customer'], default: 'customer', index: true },
  active: { type: Boolean, default: true, index: true },
  customerId: { type: Schema.Types.ObjectId, ref: 'Customer' },
}, options);

const customerSchema = new Schema({
  name: { type: String, required: true, trim: true },
  phone: { type: String, trim: true, index: true, sparse: true },
  email: { type: String, lowercase: true, trim: true, index: true, unique: true, sparse: true },
  whatsappOptIn: { type: Boolean, default: false },
  notificationPreferences: {
    push: { type: Boolean, default: false }, inApp: { type: Boolean, default: true },
    chargingReminders: { type: Boolean, default: true }, workspaceAvailability: { type: Boolean, default: false },
  },
  lastWorkspaceNotificationAt: Date,
}, options);

const productSchema = new Schema({
  sku: { type: String, required: true, unique: true, uppercase: true, trim: true },
  name: { type: String, required: true, trim: true }, description: String,
  category: { type: String, required: true, index: true }, costPrice: money, sellingPrice: money,
  quantityOnHand: { type: Number, required: true, min: 0, default: 0 },
  reorderThreshold: { type: Number, required: true, min: 0, default: 0 },
  active: { type: Boolean, default: true, index: true },
}, options);
productSchema.index({ name: 'text', sku: 'text', category: 'text' });

const movementSchema = new Schema({
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
  previousQuantity: { type: Number, required: true }, quantity: { type: Number, required: true },
  newQuantity: { type: Number, required: true }, type: { type: String, enum: ['opening', 'restock', 'write-off', 'correction', 'return', 'sale', 'other'], default: 'other' },
  reason: { type: String, required: true }, note: String,
  createdBy: { type: String, required: true },
}, options);

const chargingSchema = new Schema({
  customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
  customerName: String, publicSessionId: { type: String, required: true, unique: true, index: true },
  secureClaimToken: { type: String, required: true, unique: true, select: false },
  device: {
    type: { type: String, enum: ['phone', 'laptop', 'tablet', 'powerbank', 'other'], required: true },
    brand: String, model: String, color: String, description: String,
  },
  slotNumber: { type: Number, required: true }, timeIn: { type: Date, required: true, default: Date.now },
  estimatedReadyAt: Date, readyAt: Date, collectedAt: Date,
  reminderSentAt: Date,
  status: { type: String, enum: ['checked-in', 'charging', 'ready', 'collected', 'cancelled'], default: 'checked-in', index: true },
  amount: money, paymentStatus: { type: String, enum: ['pending', 'paid'], default: 'pending' },
  paymentMethod: { type: String, enum: ['cash', 'transfer', 'card', 'other'], default: 'cash' },
}, options);
chargingSchema.index({ createdAt: -1 });
chargingSchema.index({ customerName: 'text', publicSessionId: 'text' });

const workspaceSchema = new Schema({
  customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
  customerName: String, phone: String,
  deviceInfo: { type: { type: String }, brand: String, model: String },
  seatNumber: Number, timeIn: Date, timeOut: Date, amount: { type: Number, min: 0, default: 0 },
  paymentMethod: { type: String, enum: ['cash', 'transfer', 'card', 'other'], default: 'cash' },
  status: { type: String, enum: ['registered', 'checked-in', 'checked-out', 'cancelled'], default: 'registered', index: true },
}, options);
workspaceSchema.index({ createdAt: -1 });

const saleSchema = new Schema({
  customerId: { type: Schema.Types.ObjectId, ref: 'Customer', index: true },
  items: [{ productId: { type: Schema.Types.ObjectId, ref: 'Product' }, name: String, quantity: Number, unitPrice: Number, subtotal: Number }],
  total: money, paymentMethod: { type: String, enum: ['cash', 'transfer', 'card', 'other'], required: true },
}, options);
saleSchema.index({ createdAt: -1 });

const transactionSchema = new Schema({
  type: { type: String, enum: ['stock_sale', 'charging_fee', 'workspace_fee', 'inventory_purchase', 'expense', 'adjustment'], required: true, index: true },
  amount: money, direction: { type: String, enum: ['income', 'expense'], required: true, index: true },
  paymentMethod: { type: String, enum: ['cash', 'transfer', 'card', 'other'], required: true },
  customerId: { type: Schema.Types.ObjectId, ref: 'Customer', index: true },
  referenceType: String, referenceId: { type: Schema.Types.ObjectId, index: true },
  description: { type: String, required: true }, createdBy: { type: String, required: true },
}, options);
transactionSchema.index({ createdAt: -1 });

const receiptSchema = new Schema({
  receiptNumber: { type: String, required: true, unique: true, index: true },
  type: { type: String, enum: ['sale', 'charging', 'workspace'], required: true },
  customerId: { type: Schema.Types.ObjectId, ref: 'Customer', index: true }, customerName: String,
  referenceId: { type: Schema.Types.ObjectId, required: true, index: true }, claimId: String,
  subtotal: money, total: money,
  paymentMethod: { type: String, enum: ['cash', 'transfer', 'card', 'other'], required: true },
  details: Schema.Types.Mixed, generatedAt: { type: Date, default: Date.now, index: true },
}, { ...options, timestamps: false });

const notificationSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'AppUser', index: true },
  customerId: { type: Schema.Types.ObjectId, ref: 'Customer', index: true },
  title: { type: String, required: true }, message: { type: String, required: true },
  type: { type: String, enum: ['charging_ready', 'charging_reminder', 'workspace_available', 'low_stock', 'system'], required: true },
  read: { type: Boolean, default: false },
}, options);
notificationSchema.index({ createdAt: -1 });

const pushSubscriptionSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'AppUser' }, customerId: { type: Schema.Types.ObjectId, ref: 'Customer' },
  endpoint: { type: String, required: true, unique: true },
  keys: { p256dh: { type: String, required: true }, auth: { type: String, required: true } },
}, options);

const auditSchema = new Schema({
  actorId: { type: String, required: true, index: true }, action: { type: String, required: true, index: true },
  entityType: { type: String, required: true }, entityId: String, metadata: Schema.Types.Mixed,
}, options);
auditSchema.index({ createdAt: -1 });

const settingSchema = new Schema({
  key: { type: String, default: 'business', unique: true },
  businessName: { type: String, default: 'SANFAANI' }, businessAddress: String, phone: String,
  currency: { type: String, default: 'NGN' }, chargingCapacity: { type: Number, default: 40, min: 1 },
  workspaceCapacity: { type: Number, default: 20, min: 1 },
  defaultChargingPrice: { type: Number, default: 1000, min: 0 },
  defaultWorkspacePrice: { type: Number, default: 1500, min: 0 },
  whatsappGroupInviteUrl: String, businessTimezone: { type: String, default: 'Africa/Lagos' }, receiptFooter: String,
}, options);

const resourceLockSchema = new Schema({
  resource: { type: String, enum: ['charging', 'workspace'], required: true },
  position: { type: Number, required: true }, occupied: { type: Boolean, default: false, index: true },
  referenceId: { type: Schema.Types.ObjectId, default: null },
}, options);
resourceLockSchema.index({ resource: 1, position: 1 }, { unique: true });
resourceLockSchema.index({ resource: 1, referenceId: 1 }, { unique: true, partialFilterExpression: { referenceId: { $type: 'objectId' } } });

export const AppUser = mongoose.model('AppUser', appUserSchema);
export const Customer = mongoose.model('Customer', customerSchema);
export const Product = mongoose.model('Product', productSchema);
export const InventoryMovement = mongoose.model('InventoryMovement', movementSchema);
export const ChargingSession = mongoose.model('ChargingSession', chargingSchema);
export const WorkspaceBooking = mongoose.model('WorkspaceBooking', workspaceSchema);
export const Sale = mongoose.model('Sale', saleSchema);
export const Transaction = mongoose.model('Transaction', transactionSchema);
export const Receipt = mongoose.model('Receipt', receiptSchema);
export const Notification = mongoose.model('Notification', notificationSchema);
export const PushSubscription = mongoose.model('PushSubscription', pushSubscriptionSchema);
export const AuditLog = mongoose.model('AuditLog', auditSchema);
export const Setting = mongoose.model('Setting', settingSchema);
export const ResourceLock = mongoose.model('ResourceLock', resourceLockSchema);
