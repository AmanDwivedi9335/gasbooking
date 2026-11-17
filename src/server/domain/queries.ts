import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import * as M from '../models';
import { invariant } from '../db';
import { authorize, bookingScope, scope, type Actor, type Permission } from '../policy';
import { decrypt } from '../crypto';

type Filter = { branchId?: string; cursor?: string; status?: string; search?: string; limit: number };

function clean<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (key, field) => ['_id', '__v', 'requestKey', 'requestHash', 'leaseToken', 'bookingVersion',
    'encryptedCredential', 'encryptedSigningSecret', 'passwordHash', 'mfaSecret', 'encryptedDeliveryOtp'].includes(key) ? undefined : field)) as T;
}
export { clean };

const searchPattern = (value: string) => new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

async function page<T>(model: Model<T>, query: object, options: Filter) {
  const cursor = options.cursor ? { _id: { $lt: new Types.ObjectId(options.cursor) } } : {};
  const rows = await model.find({ ...query, ...cursor }).sort({ _id: -1 }).limit(options.limit + 1).lean();
  const more = rows.length > options.limit;
  const selected = rows.slice(0, options.limit);
  return { rows: clean(selected), nextCursor: more ? String(selected.at(-1)?._id) : null };
}

export async function bookings(actor: Actor, options: Filter) {
  authorize(actor, 'booking:read');
  const query = { ...bookingScope(actor, options.branchId), ...(options.status ? { status: options.status } : {}) };
  const search = options.search && searchPattern(options.search);
  return page(M.Booking, { ...query, ...(search ? { $or: [{ number: search }, { customerName: search }, { productName: search }] } : {}) }, options);
}

export async function bookingDetail(actor: Actor, id: string) {
  authorize(actor, 'booking:read');
  const query = M.Booking.findOne({ ...bookingScope(actor), id });
  if (actor.role === 'CUSTOMER') query.select('+encryptedDeliveryOtp');
  const booking = await query.lean();
  invariant(booking, 404, 'BOOKING_NOT_FOUND', 'Booking not found.');
  const filter = { agencyId: booking.agencyId, branchId: booking.branchId, bookingId: id };
  const [events, invoice, proof, customer] = await Promise.all([
    M.BookingEvent.find(filter).sort({ _id: 1 }).limit(200).lean(),
    M.Invoice.findOne(filter).lean(),
    actor.role === 'CUSTOMER' ? null : M.Proof.findOne(filter).lean(),
    actor.role === 'CUSTOMER' ? null : M.Customer.findOne({ agencyId: booking.agencyId, branchId: booking.branchId, id: booking.customerId }).select('phone -_id').lean(),
  ]);
  const deliveryCode = actor.role === 'CUSTOMER' && booking.status === 'OUT_FOR_DELIVERY' && booking.encryptedDeliveryOtp &&
    booking.deliveryOtpExpiresAt && booking.deliveryOtpExpiresAt > new Date() ? decrypt(booking.encryptedDeliveryOtp) : undefined;
  return clean({ booking, events, invoice, proof, phone: customer?.phone, deliveryCode });
}

const listings = {
  customers: [M.Customer, 'customer:read'], connections: [M.Connection, 'customer:read'],
  products: [M.Product, 'catalog:read'], prices: [M.Price, 'catalog:read'], warehouses: [M.Warehouse, 'inventory:read'],
  balances: [M.Balance, 'inventory:read'], movements: [M.Movement, 'inventory:read'], reconciliations: [M.Reconciliation, 'inventory:read'], invoices: [M.Invoice, 'finance:read'],
  payments: [M.Payment, 'finance:read'], complaints: [M.Complaint, 'support:read'], audit: [M.Audit, 'audit:read'],
  communications: [M.Outbox, 'integration:manage'],
} as const;
type Listing = keyof typeof listings;
export function isListing(value: string): value is Listing { return Object.hasOwn(listings, value); }

export async function list(actor: Actor, resource: Listing, options: Filter) {
  const [model, permission] = listings[resource];
  if (!(resource === 'payments' && actor.role === 'DRIVER')) authorize(actor, permission);
  const filter: Record<string, unknown> = scope(actor, options.branchId);
  if (actor.role === 'CUSTOMER') {
    if (resource === 'customers') filter.id = actor.customerId;
    if (['connections', 'invoices', 'payments', 'complaints'].includes(resource)) filter.customerId = actor.customerId;
  }
  if (actor.role === 'DRIVER' && resource === 'payments') filter.actorId = actor.userId;
  if (resource === 'customers' && options.search) {
    const match = searchPattern(options.search);
    const connections = await M.Connection.find({ ...scope(actor, options.branchId),
      ...(actor.role === 'CUSTOMER' ? { customerId: actor.customerId } : {}), consumerNumber: match }).limit(100).select('customerId').lean();
    filter.$or = [{ name: match }, { phone: match }, { id: { $in: connections.map(connection => connection.customerId) } }];
  }
  if (resource === 'communications' && options.status) filter.status = options.status;
  return page(model as unknown as Model<Record<string, unknown>>, filter, options);
}

export async function agents(actor: Actor, branchId: string | undefined, permission: Permission = 'delivery:assign') {
  authorize(actor, permission);
  scope(actor, branchId);
  const members = await M.Membership.find({ agencyId: actor.agencyId, active: true, role: 'DRIVER',
    branchIds: branchId ?? { $in: actor.branchIds } }).limit(500).lean();
  const users = await M.User.find({ id: { $in: members.map(member => member.userId) }, active: true }).select('id name email -_id').lean();
  return users;
}

export async function staff(actor: Actor, branchId?: string) {
  authorize(actor, 'staff:manage');
  scope(actor, branchId);
  const members = await M.Membership.find({ agencyId: actor.agencyId, branchIds: branchId ?? { $in: actor.branchIds } }).limit(500).lean();
  const users = await M.User.find({ id: { $in: members.map(member => member.userId) } }).select('id name email active -_id').lean();
  const byId = new Map(users.map(user => [user.id, user]));
  return members.map(member => ({ id: member.id, userId: member.userId, name: byId.get(member.userId)?.name, email: byId.get(member.userId)?.email,
    role: member.role, active: member.active && byId.get(member.userId)?.active, branchIds: member.branchIds }));
}

export async function dashboard(actor: Actor, branchId: string | undefined, from: string, to: string) {
  authorize(actor, 'dashboard:read');
  const tenant = scope(actor, branchId);
  const start = new Date(from + 'T00:00:00+05:30');
  const end = new Date(new Date(to + 'T00:00:00+05:30').getTime() + 86_400_000);
  invariant(end > start && end.getTime() - start.getTime() <= 366 * 86_400_000, 400, 'INVALID_DATE_RANGE', 'Select a range of up to 366 days.');
  const date = { $gte: start, $lt: end };
  const [activity, status, revenue, customers, connections, inventory, openInvoices, failures, recent, delivery] = await Promise.all([
    M.Booking.aggregate<{ _id: string; bookings: number; delivered: number }>([
      { $match: { ...tenant, createdAt: date } },
      { $group: { _id: { $dateToString: { date: '$createdAt', format: '%Y-%m-%d', timezone: 'Asia/Kolkata' } },
        bookings: { $sum: 1 }, delivered: { $sum: { $cond: [{ $in: ['$status', ['DELIVERED', 'CLOSED']] }, 1, 0] } } } },
      { $sort: { _id: 1 } },
    ]),
    M.Booking.aggregate<{ _id: string; count: number }>([{ $match: { ...tenant, createdAt: date } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    M.Payment.aggregate<{ _id: null; total: number }>([{ $match: { ...tenant, createdAt: date } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
    M.Customer.countDocuments({ ...tenant, active: true }),
    M.Connection.countDocuments({ ...tenant, active: true }),
    M.Balance.aggregate<{ _id: string; available: number; empty: number; reserved: number; inTransit: number }>([
      { $match: tenant }, { $group: { _id: '$productId', available: { $sum: { $subtract: ['$filled', '$reserved'] } },
        empty: { $sum: '$empty' }, reserved: { $sum: '$reserved' }, inTransit: { $sum: '$inTransit' } } },
    ]),
    M.Invoice.countDocuments({ ...tenant, status: { $in: ['OPEN', 'PARTIAL'] } }),
    M.Outbox.countDocuments({ ...tenant, status: 'DEAD', createdAt: date }),
    M.Booking.find({ ...tenant, createdAt: date }).sort({ createdAt: -1, _id: -1 }).limit(6).lean(),
    M.Booking.aggregate<{ _id: string; completed: number; failed: number; averageHours: number }>([
      { $match: { ...tenant, createdAt: date, agentName: { $exists: true }, status: { $in: ['DELIVERED', 'CLOSED', 'FAILED_DELIVERY'] } } },
      { $group: { _id: '$agentName', completed: { $sum: { $cond: [{ $in: ['$status', ['DELIVERED', 'CLOSED']] }, 1, 0] } },
        failed: { $sum: { $cond: [{ $eq: ['$status', 'FAILED_DELIVERY'] }, 1, 0] } },
        averageHours: { $avg: { $divide: [{ $subtract: ['$deliveredAt', '$createdAt'] }, 3_600_000] } } } },
      { $sort: { completed: -1 } }, { $limit: 15 },
    ]),
  ]);
  const products = await M.Product.find({ ...tenant, active: true }).select('id name lowStock sku -_id').lean();
  const counts = Object.fromEntries(status.map(row => [row._id, row.count]));
  const byDate = new Map(activity.map(day => [day._id, day]));
  const trend = [];
  for (let day = start.getTime(); day < end.getTime(); day += 86_400_000) {
    const label = new Date(day + 19_800_000).toISOString().slice(0, 10);
    const row = byDate.get(label);
    trend.push({ date: label, bookings: row?.bookings ?? 0, delivered: row?.delivered ?? 0 });
  }
  return clean({ customers, connections, openInvoices, failures, counts, collections: revenue[0]?.total ?? 0,
    total: status.reduce((sum, row) => sum + row.count, 0), trend, recent, delivery: delivery.map(({ _id, ...fields }) => ({ name: _id, ...fields })),
    stock: products.map(product => {
      const balance = inventory.find(row => row._id === product.id);
      return { ...product, available: balance?.available ?? 0, empty: balance?.empty ?? 0, reserved: balance?.reserved ?? 0, inTransit: balance?.inTransit ?? 0 };
    }) });
}
