import mongoose, { type InferSchemaType, type Model, Schema } from 'mongoose';
import { randomUUID } from 'node:crypto';

const id = { type: String, default: randomUUID, unique: true, required: true } as const;
const required = { type: String, required: true } as const;
const count = { type: Number, required: true, min: 0, default: 0 } as const;
const scope = { agencyId: required, branchId: required };
const address = new Schema({ line: required, city: required, state: String, pincode: required, landmark: String, instructions: String }, { _id: false });
const pricing = new Schema({ unit: count, subtotal: count, tax: count, delivery: count, total: count }, { _id: false });

function model<T extends Schema>(collection: string, schema: T): Model<InferSchemaType<T>> {
  return (mongoose.models[collection] as Model<InferSchemaType<T>>) || mongoose.model<InferSchemaType<T>>(collection, schema, collection);
}

const branchSchema = new Schema({ id, agencyId: required, name: required, code: required, deliveryOtp: { type: Boolean, default: false } }, { timestamps: true });
branchSchema.index({ agencyId: 1, code: 1 }, { unique: true });
export const Branch = model('branches', branchSchema);
export const Agency = model('agencies', new Schema({ id, name: required, emergencyContact: String }, { timestamps: true }));

export const User = model('users', new Schema({
  id, email: { ...required, unique: true }, name: required, passwordHash: { ...required, select: false },
  active: { type: Boolean, default: true }, demo: { type: Boolean, default: false },
  mfaSecret: { type: String, select: false }, lastMfaStep: Number,
}, { timestamps: true }));
const membership = new Schema({
  id, agencyId: required, userId: required, branchIds: [String], role: required, customerId: String, active: { type: Boolean, default: true },
}, { timestamps: true });
membership.index({ userId: 1, agencyId: 1 }, { unique: true });
membership.index({ agencyId: 1, customerId: 1, role: 1, active: 1 });
membership.index({ agencyId: 1, role: 1, branchIds: 1, active: 1 });
export const Membership = model('memberships', membership);
export const Session = model('sessions', new Schema({
  id, tokenHash: { ...required, unique: true }, membershipId: required, expiresAt: { type: Date, required: true, expires: 0 },
}, { timestamps: true }));
export const RateLimit = model('rate_limits', new Schema({
  key: { ...required, unique: true }, attempts: count, expiresAt: { type: Date, required: true, expires: 0 },
}));

const customer = new Schema({ id, ...scope, name: required, phone: required, alternatePhone: String, email: String,
  category: { ...required, enum: ['DOMESTIC', 'COMMERCIAL'] }, address: { type: address, required: true },
  active: { type: Boolean, default: true }, whatsappOptInAt: Date,
}, { timestamps: true, optimisticConcurrency: true });
customer.index({ agencyId: 1, phone: 1 }, { unique: true });
customer.index({ agencyId: 1, branchId: 1, _id: -1 });
export const Customer = model('customers', customer);

const connection = new Schema({ id, ...scope, customerId: required, consumerNumber: required,
  provider: String, productIds: [String], maxQuantity: { ...count, default: 1 }, refillIntervalDays: count,
  active: { type: Boolean, default: true }, bookingVersion: count,
}, { timestamps: true, optimisticConcurrency: true });
connection.index({ agencyId: 1, consumerNumber: 1 }, { unique: true });
connection.index({ agencyId: 1, branchId: 1, customerId: 1, _id: -1 });
export const Connection = model('gas_connections', connection);

const product = new Schema({ id, ...scope, name: required, sku: required, weightKg: { type: Number, required: true, min: 0 },
  category: required, active: { type: Boolean, default: true }, lowStock: { ...count, default: 10 },
}, { timestamps: true });
product.index({ agencyId: 1, branchId: 1, sku: 1 }, { unique: true });
export const Product = model('cylinder_products', product);
const price = new Schema({ id, ...scope, productId: required, unit: count, taxBps: count, delivery: count, effectiveAt: { type: Date, required: true } }, { timestamps: true });
price.index({ agencyId: 1, branchId: 1, productId: 1, effectiveAt: -1 }, { unique: true });
export const Price = model('price_lists', price);

const warehouse = new Schema({ id, ...scope, name: required, code: required }, { timestamps: true });
warehouse.index({ agencyId: 1, branchId: 1, code: 1 }, { unique: true });
export const Warehouse = model('warehouses', warehouse);
const balance = new Schema({ id, ...scope, warehouseId: required, productId: required,
  filled: count, empty: count, reserved: count, inTransit: count, damaged: count, quarantined: count,
}, { timestamps: true });
balance.index({ agencyId: 1, branchId: 1, warehouseId: 1, productId: 1 }, { unique: true });
export const Balance = model('inventory_balances', balance);
const movement = new Schema({ id, ...scope, warehouseId: required, productId: required, bookingId: String,
  action: required, actorId: required, reason: String, deltas: { type: Map, of: Number, required: true },
}, { timestamps: true });
movement.index({ agencyId: 1, branchId: 1, _id: -1 });
export const Movement = model('inventory_movements', movement);
const reconciliation = new Schema({
  id, ...scope, warehouseId: required, productId: required, createdBy: required, reason: required, status: required,
  baseline: new Schema({ filled: count, empty: count, damaged: count, quarantined: count }, { _id: false }),
  counted: new Schema({ filled: count, empty: count, damaged: count, quarantined: count }, { _id: false }),
  reviewedBy: String, reviewedAt: Date, reviewNote: String,
}, { timestamps: true, optimisticConcurrency: true });
reconciliation.index({ agencyId: 1, branchId: 1, _id: -1 });
reconciliation.index({ agencyId: 1, branchId: 1, warehouseId: 1, productId: 1 }, { unique: true, partialFilterExpression: { status: 'PENDING' } });
export const Reconciliation = model('inventory_reconciliations', reconciliation);

const booking = new Schema({
  id, ...scope, number: required, customerId: required, customerName: required, connectionId: required,
  productId: required, productName: required, quantity: { ...count, min: 1 }, status: required, source: required,
  deliveryAddress: { type: address, required: true }, price: { type: pricing, required: true },
  warehouseId: String, agentId: String, agentName: String, createdBy: required, requestKey: required, requestHash: required,
  preferredDate: Date, notes: String, deliveredAt: Date, holdFrom: String,
  deliveryOtpRequired: Boolean, encryptedDeliveryOtp: { type: String, select: false }, deliveryOtpExpiresAt: Date,
}, { timestamps: true, optimisticConcurrency: true });
booking.index({ agencyId: 1, number: 1 }, { unique: true });
booking.index({ agencyId: 1, branchId: 1, createdBy: 1, requestKey: 1 }, { unique: true });
booking.index({ agencyId: 1, branchId: 1, status: 1, createdAt: -1 });
booking.index({ agencyId: 1, branchId: 1, createdAt: -1 });
booking.index({ agencyId: 1, branchId: 1, _id: -1 });
booking.index({ agencyId: 1, branchId: 1, connectionId: 1, createdAt: -1 });
booking.index({ agencyId: 1, branchId: 1, customerId: 1, _id: -1 });
booking.index({ agencyId: 1, branchId: 1, agentId: 1, _id: -1 });
export const Booking = model('bookings', booking);
const event = new Schema({ id, ...scope, bookingId: required, actorId: required, from: String, to: required, reason: String }, { timestamps: true });
event.index({ agencyId: 1, branchId: 1, bookingId: 1, _id: 1 });
export const BookingEvent = model('booking_events', event);
const reservation = new Schema({ id, ...scope, bookingId: required, warehouseId: required, productId: required, quantity: count, state: required }, { timestamps: true });
reservation.index({ agencyId: 1, bookingId: 1, state: 1 }, { unique: true, partialFilterExpression: { state: 'ACTIVE' } });
export const Reservation = model('stock_reservations', reservation);
const assignment = new Schema({ id, ...scope, bookingId: required, agentId: required, state: required }, { timestamps: true });
assignment.index({ agencyId: 1, bookingId: 1, state: 1 }, { unique: true, partialFilterExpression: { state: 'ASSIGNED' } });
export const Assignment = model('delivery_assignments', assignment);
const proof = new Schema({ id, ...scope, bookingId: required, agentId: required, recipient: required, reference: String, delivered: count, empties: count,
  otpVerifiedAt: Date }, { timestamps: true });
proof.index({ agencyId: 1, bookingId: 1 }, { unique: true });
export const Proof = model('proof_of_delivery', proof);

const invoice = new Schema({ id, ...scope, bookingId: required, number: required, customerId: required, customerName: required,
  quantity: count, productName: required, price: { type: pricing, required: true }, paid: count, status: required,
}, { timestamps: true, optimisticConcurrency: true });
invoice.index({ agencyId: 1, bookingId: 1 }, { unique: true });
invoice.index({ agencyId: 1, branchId: 1, customerId: 1, _id: -1 });
export const Invoice = model('invoices', invoice);
const payment = new Schema({ id, ...scope, invoiceId: required, bookingId: required, customerId: required,
  amount: count, mode: required, reference: String, actorId: required, requestKey: required,
}, { timestamps: true });
payment.index({ agencyId: 1, actorId: 1, requestKey: 1 }, { unique: true });
payment.index({ agencyId: 1, reference: 1 }, { unique: true, partialFilterExpression: { mode: 'UPI' } });
payment.index({ agencyId: 1, branchId: 1, customerId: 1, _id: -1 });
export const Payment = model('payments', payment);

const complaint = new Schema({ id, ...scope, customerId: required, subject: required, description: required, category: required, status: required,
  priority: required, assignedTo: String, dueAt: { type: Date, required: true },
}, { timestamps: true, optimisticConcurrency: true });
complaint.index({ agencyId: 1, branchId: 1, customerId: 1, _id: -1 });
export const Complaint = model('complaints', complaint);
const audit = new Schema({ id, ...scope, actorId: required, action: required, entityId: required, detail: Schema.Types.Mixed }, { timestamps: true });
audit.index({ agencyId: 1, branchId: 1, _id: -1 });
export const Audit = model('audit_logs', audit);
const integration = new Schema({
  id, agencyId: { ...required, unique: true }, enabled: Boolean, environment: String, account: String, sender: String,
  apiBase: String, encryptedCredential: { type: String, select: false }, encryptedSigningSecret: { type: String, select: false },
  templates: { type: Map, of: String }, lastSuccessAt: Date, lastWebhookAt: Date,
}, { timestamps: true });
export const Integration = model('winquly_integrations', integration);
const outbox = new Schema({
  id, ...scope, event: required, entityId: required, customerId: required, status: required, attempts: count,
  dueAt: { type: Date, required: true }, leaseUntil: Date, leaseToken: String, failure: String, externalId: String,
}, { timestamps: true });
outbox.index({ status: 1, dueAt: 1, leaseUntil: 1 });
outbox.index({ agencyId: 1, branchId: 1, _id: -1 });
outbox.index({ agencyId: 1, branchId: 1, externalId: 1 }, { sparse: true });
export const Outbox = model('outbox_events', outbox);
const webhook = new Schema({
  id, ...scope, providerEventId: required, event: required, payload: Schema.Types.Mixed, status: required,
}, { timestamps: true });
webhook.index({ agencyId: 1, providerEventId: 1 }, { unique: true });
webhook.index({ status: 1, _id: 1 });
export const Webhook = model('webhook_events', webhook);

export const models = [Agency, Branch, User, Membership, Session, RateLimit, Customer, Connection, Product, Price,
  Warehouse, Balance, Movement, Reconciliation, Booking, BookingEvent, Reservation, Assignment, Proof, Invoice, Payment,
  Complaint, Audit, Integration, Outbox, Webhook];

