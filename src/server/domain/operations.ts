import type { z } from 'zod';
import { invariant, transaction } from '../db';
import { encrypt } from '../crypto';
import { passwordHash } from '../auth';
import { authorize, scope, type Actor } from '../policy';
import * as S from '../schemas';
import * as M from '../models';
import { moveStock } from './bookings';
import { enqueue, record } from './shared';

export async function registerCustomer(actor: Actor, value: z.infer<typeof S.customer>) {
  authorize(actor, 'customer:write');
  const tenant = scope(actor, value.branchId);
  return transaction(async () => {
    const customer = await M.Customer.create({ ...value, ...tenant, whatsappOptInAt: value.whatsappOptIn ? new Date() : undefined });
    await record(actor, customer.branchId, 'CUSTOMER_CREATED', customer.id);
    await enqueue({ ...customer.toObject(), customerId: customer.id }, 'CUSTOMER_REGISTERED');
    return customer;
  });
}

export async function updateCustomer(actor: Actor, id: string, value: z.infer<typeof S.customer>) {
  authorize(actor, 'customer:write');
  const tenant = scope(actor, value.branchId);
  return transaction(async () => {
    const customer = await M.Customer.findOne({ ...tenant, id });
    invariant(customer, 404, 'CUSTOMER_NOT_FOUND', 'Customer not found.');
    if (customer.category !== value.category) {
      invariant(!await M.Connection.exists({ ...tenant, customerId: id, active: true }), 409, 'ACTIVE_CONNECTION',
        'Deactivate existing connections before changing the customer category.');
    }
    const before = { category: customer.category, whatsappOptIn: Boolean(customer.whatsappOptInAt) };
    customer.set({ ...value, email: value.email, alternatePhone: value.alternatePhone,
      whatsappOptInAt: value.whatsappOptIn ? customer.whatsappOptInAt ?? new Date() : undefined });
    await customer.save();
    await record(actor, value.branchId, 'CUSTOMER_UPDATED', id, { before, after: { category: value.category, whatsappOptIn: value.whatsappOptIn } });
    return customer;
  });
}

export async function registerConnection(actor: Actor, value: z.infer<typeof S.connection>) {
  authorize(actor, 'customer:write');
  const tenant = scope(actor, value.branchId);
  return transaction(async () => {
    const customer = await M.Customer.findOne({ ...tenant, id: value.customerId, active: true });
    invariant(customer, 404, 'CUSTOMER_NOT_FOUND', 'Select an active customer.');
    const ids = [...new Set(value.productIds)];
    const matching = await M.Product.countDocuments({ ...tenant, id: { $in: ids }, category: customer.category, active: true });
    invariant(matching === ids.length, 422, 'PRODUCT_NOT_FOUND', 'Products must be active and match the customer category.');
    const connection = await M.Connection.create({ ...value, ...tenant, productIds: ids });
    await record(actor, connection.branchId, 'CONNECTION_CREATED', connection.id);
    return connection;
  });
}

export async function addProduct(actor: Actor, value: z.infer<typeof S.product>) {
  authorize(actor, 'catalog:write');
  return transaction(async () => {
    const product = await M.Product.create({ ...value, ...scope(actor, value.branchId) });
    await record(actor, product.branchId, 'PRODUCT_CREATED', product.id);
    return product;
  });
}

export async function addPrice(actor: Actor, value: z.infer<typeof S.price>) {
  authorize(actor, 'catalog:write');
  const tenant = scope(actor, value.branchId);
  return transaction(async () => {
    invariant(await M.Product.exists({ ...tenant, id: value.productId, active: true }), 404, 'PRODUCT_NOT_FOUND', 'Select an active product.');
    const price = await M.Price.create({ ...value, ...tenant, effectiveAt: new Date(value.effectiveAt + 'T00:00:00+05:30') });
    await record(actor, price.branchId, 'PRICE_CREATED', price.id);
    return price;
  });
}

export async function addWarehouse(actor: Actor, value: z.infer<typeof S.warehouse>) {
  authorize(actor, 'inventory:write');
  return transaction(async () => {
    const warehouse = await M.Warehouse.create({ ...value, ...scope(actor, value.branchId) });
    await record(actor, warehouse.branchId, 'WAREHOUSE_CREATED', warehouse.id);
    return warehouse;
  });
}

export async function changeStock(actor: Actor, value: z.infer<typeof S.stock>) {
  authorize(actor, 'inventory:write');
  const tenant = scope(actor, value.branchId);
  return transaction(async () => {
    invariant(await M.Product.exists({ ...tenant, id: value.productId }), 404, 'PRODUCT_NOT_FOUND', 'Product not found.');
    const source = await M.Warehouse.exists({ ...tenant, id: value.warehouseId });
    invariant(source, 404, 'WAREHOUSE_NOT_FOUND', 'Warehouse not found.');
    const key = { ...tenant, warehouseId: value.warehouseId, productId: value.productId };
    const context = { reason: value.reason };
    if (value.type === 'TRANSFER') {
      invariant(value.toWarehouseId && value.toWarehouseId !== value.warehouseId &&
        await M.Warehouse.exists({ ...tenant, id: value.toWarehouseId }), 422, 'DESTINATION_REQUIRED', 'Select a different warehouse in this branch.');
      await moveStock(key, { [value.bucket]: -value.quantity }, actor.userId, 'TRANSFER_OUT', context);
      const balance = await moveStock({ ...key, warehouseId: value.toWarehouseId }, { [value.bucket]: value.quantity }, actor.userId, 'TRANSFER_IN', context);
      await record(actor, value.branchId, 'STOCK_TRANSFER', balance.id, value);
      return balance;
    }
    const balance = await moveStock(key, { [value.bucket]: value.quantity }, actor.userId, value.type, context);
    await record(actor, value.branchId, 'STOCK_' + value.type, balance.id, value);
    return balance;
  });
}

const physicalBuckets = ['filled', 'empty', 'damaged', 'quarantined'] as const;

export async function requestReconciliation(actor: Actor, value: z.infer<typeof S.reconciliation>) {
  authorize(actor, 'inventory:write');
  const tenant = scope(actor, value.branchId);
  return transaction(async () => {
    invariant(await M.Warehouse.exists({ ...tenant, id: value.warehouseId }) &&
      await M.Product.exists({ ...tenant, id: value.productId }), 404, 'STOCK_LOCATION_NOT_FOUND', 'Select a valid warehouse and product.');
    const balance = await M.Balance.findOne({ ...tenant, warehouseId: value.warehouseId, productId: value.productId });
    const baseline = Object.fromEntries(physicalBuckets.map(bucket => [bucket, balance?.[bucket] ?? 0]));
    const entry = await M.Reconciliation.create({ ...value, ...tenant, baseline, createdBy: actor.userId, status: 'PENDING' });
    await record(actor, value.branchId, 'STOCK_COUNT_SUBMITTED', entry.id);
    return entry;
  });
}

export async function reviewReconciliation(actor: Actor, id: string, value: z.infer<typeof S.reconciliationReview>) {
  authorize(actor, 'inventory:approve');
  return transaction(async () => {
    const entry = await M.Reconciliation.findOne({ ...scope(actor), id, status: 'PENDING' });
    invariant(entry?.baseline && entry.counted, 404, 'COUNT_NOT_FOUND', 'A pending stock count was not found.');
    invariant(value.decision === 'REJECTED' || entry.createdBy !== actor.userId, 403, 'INDEPENDENT_REVIEW_REQUIRED', 'Approval requires a different authorized staff member.');
    if (value.decision === 'APPROVED') {
      const key = { agencyId: entry.agencyId, branchId: entry.branchId, warehouseId: entry.warehouseId, productId: entry.productId };
      const balance = await M.Balance.findOne(key);
      const { baseline, counted } = entry;
      invariant(physicalBuckets.every(bucket => baseline[bucket] === (balance?.[bucket] ?? 0)), 409, 'STALE_COUNT', 'Stock changed after the count. Reject this count and submit a new one.');
      const deltas = Object.fromEntries(physicalBuckets.filter(bucket => counted[bucket] !== baseline[bucket]).map(bucket => [bucket, counted[bucket] - baseline[bucket]]));
      if (Object.keys(deltas).length) await moveStock(key, deltas, actor.userId, 'RECONCILIATION', { reason: entry.reason });
    }
    entry.status = value.decision;
    entry.reviewedBy = actor.userId;
    entry.reviewedAt = new Date();
    entry.reviewNote = value.note;
    await entry.save();
    await record(actor, entry.branchId, 'STOCK_COUNT_' + value.decision, id, { note: value.note });
    return entry;
  });
}

export async function collectPayment(actor: Actor, value: z.infer<typeof S.payment>, key: string) {
  authorize(actor, 'finance:collect');
  const tenant = scope(actor);
  const lookup = { ...tenant, actorId: actor.userId, requestKey: key };
  function same<T extends { invoiceId: string; amount: number; mode: string; reference?: string | null }>(previous: T) {
    invariant(previous.invoiceId === value.invoiceId && previous.amount === value.amount && previous.mode === value.mode &&
      (previous.reference ?? undefined) === value.reference, 409, 'KEY_CONFLICT', 'This request key was used for a different payment.');
    return previous;
  }
  return transaction(async () => {
    const previous = await M.Payment.findOne(lookup);
    if (previous) return same(previous);
    const invoice = await M.Invoice.findOne({ ...tenant, id: value.invoiceId });
    invariant(invoice, 404, 'INVOICE_NOT_FOUND', 'Invoice not found.');
    if (actor.role === 'DRIVER') {
      invariant(await M.Booking.exists({ ...tenant, id: invoice.bookingId, agentId: actor.userId, status: { $in: ['DELIVERED', 'CLOSED'] } }),
        404, 'INVOICE_NOT_FOUND', 'Invoice not found for an assigned delivery.');
    }
    invariant(value.amount <= invoice.price.total - invoice.paid, 422, 'PAYMENT_EXCEEDS_BALANCE', 'The payment exceeds the outstanding amount.');
    invariant(value.mode !== 'UPI' || value.reference, 422, 'PAYMENT_REFERENCE_REQUIRED', 'Enter the reference from the verified UPI transaction.');
    const payment = await M.Payment.create({ ...lookup, ...value, branchId: invoice.branchId, bookingId: invoice.bookingId, customerId: invoice.customerId });
    invoice.paid += value.amount;
    invoice.status = invoice.paid === invoice.price.total ? 'PAID' : 'PARTIAL';
    await invoice.save();
    await record(actor, invoice.branchId, 'PAYMENT_RECORDED', payment.id, { invoiceId: invoice.id, amount: value.amount, mode: value.mode });
    await enqueue(payment, 'PAYMENT_RECEIVED');
    return payment;
  }).catch(async error => {
    if (error.code !== 11000) throw error;
    const previous = await M.Payment.findOne(lookup);
    if (!previous) throw error;
    return same(previous);
  });
}

export async function createComplaint(actor: Actor, value: z.infer<typeof S.complaint>) {
  authorize(actor, 'support:write');
  const tenant = scope(actor, value.branchId);
  const customerId = actor.role === 'CUSTOMER' ? actor.customerId : value.customerId;
  return transaction(async () => {
    invariant(customerId && await M.Customer.exists({ ...tenant, id: customerId }), 404, 'CUSTOMER_NOT_FOUND', 'Select a valid customer.');
    const urgent = value.category === 'SAFETY';
    const complaint = await M.Complaint.create({ ...value, ...tenant, customerId, status: 'OPEN', priority: urgent ? 'URGENT' : 'NORMAL',
      dueAt: new Date(Date.now() + (urgent ? 0 : 48 * 3600_000)) });
    await record(actor, complaint.branchId, 'COMPLAINT_CREATED', complaint.id, { priority: complaint.priority });
    await enqueue(complaint, 'COMPLAINT_CREATED');
    return complaint;
  });
}

export async function updateComplaint(actor: Actor, id: string, value: z.infer<typeof S.complaintUpdate>) {
  authorize(actor, 'support:manage');
  return transaction(async () => {
    const complaint = await M.Complaint.findOne({ ...scope(actor), id });
    invariant(complaint, 404, 'COMPLAINT_NOT_FOUND', 'Complaint not found.');
    invariant(complaint.status !== value.status, 409, 'SAME_STATUS', 'Select a different status.');
    const from = complaint.status;
    complaint.status = value.status;
    complaint.assignedTo = actor.userId;
    await complaint.save();
    await record(actor, complaint.branchId, 'COMPLAINT_UPDATED', id, { from, to: value.status, note: value.note });
    if (value.status === 'RESOLVED') await enqueue(complaint, 'COMPLAINT_RESOLVED');
    return complaint;
  });
}

function decodeBase32(value: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...value].map(char => alphabet.indexOf(char).toString(2).padStart(5, '0')).join('');
  return Buffer.from((bits.match(/.{8}/g) ?? []).map(byte => parseInt(byte, 2))).toString('base64');
}

export async function addStaff(actor: Actor, value: z.infer<typeof S.staff>) {
  authorize(actor, 'staff:manage');
  const tenant = scope(actor, value.branchId);
  invariant(value.role !== 'OWNER', 403, 'OWNER_PROVISIONING', 'Owner accounts require separate provisioning.');
  invariant(!['BRANCH_MANAGER', 'ACCOUNTS', 'INVENTORY', 'SUPERVISOR'].includes(value.role) || value.mfaSecret,
    422, 'MFA_REQUIRED', 'Provision an authenticator secret for this role.');
  const password = await passwordHash(value.password);
  const secret = value.mfaSecret ? encrypt(decodeBase32(value.mfaSecret)) : undefined;
  return transaction(async () => {
    if (value.role === 'CUSTOMER') {
      invariant(value.customerId && await M.Customer.exists({ ...tenant, id: value.customerId, active: true }), 404, 'CUSTOMER_NOT_FOUND', 'Select an active customer.');
    }
    const user = await M.User.create({ name: value.name, email: value.email, passwordHash: password, mfaSecret: secret });
    const member = await M.Membership.create({ userId: user.id, agencyId: actor.agencyId, role: value.role,
      branchIds: [value.branchId], customerId: value.role === 'CUSTOMER' ? value.customerId : undefined });
    await record(actor, value.branchId, 'MEMBER_CREATED', member.id, { role: member.role, userId: user.id });
    return { id: member.id, name: user.name, email: user.email, role: member.role };
  });
}

export async function addBranch(actor: Actor, value: z.infer<typeof S.branch>) {
  authorize(actor, 'staff:manage');
  return transaction(async () => {
    const branch = await M.Branch.create({ ...value, agencyId: actor.agencyId });
    await M.Membership.updateOne({ id: actor.membershipId, agencyId: actor.agencyId }, { $addToSet: { branchIds: branch.id } });
    await record(actor, branch.id, 'BRANCH_CREATED', branch.id);
    return branch;
  });
}

export async function updateBranch(actor: Actor, id: string, value: z.infer<typeof S.branchSettings>) {
  authorize(actor, 'staff:manage');
  scope(actor, id);
  return transaction(async () => {
    const branch = await M.Branch.findOneAndUpdate({ id, agencyId: actor.agencyId }, { $set: value }, { returnDocument: 'after' });
    invariant(branch, 404, 'BRANCH_NOT_FOUND', 'Branch not found.');
    await record(actor, id, 'BRANCH_SETTINGS_UPDATED', id, value);
    return branch;
  });
}

export async function saveIntegration(actor: Actor, value: z.infer<typeof S.integration>) {
  authorize(actor, 'integration:manage');
  const { credential, signingSecret, ...fields } = value;
  return transaction(async () => {
    const integration = await M.Integration.findOneAndUpdate({ agencyId: actor.agencyId }, { $set: {
      ...fields, ...(credential ? { encryptedCredential: encrypt(credential) } : {}),
      ...(signingSecret ? { encryptedSigningSecret: encrypt(signingSecret) } : {}),
    } }, { upsert: true, returnDocument: 'after' });
    await record(actor, actor.branchIds[0], 'WINQULY_CONFIGURED', integration.id);
    return integration;
  });
}
