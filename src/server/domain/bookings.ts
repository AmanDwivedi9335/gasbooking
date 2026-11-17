import { randomUUID, createHash, randomInt, timingSafeEqual } from 'node:crypto';
import type { z } from 'zod';
import * as input from '../schemas';
import { Assignment, Balance, Booking, BookingEvent, Branch, Connection, Customer, Invoice, Membership, Movement, Price, Product, Proof, Reservation, User, Warehouse } from '../models';
import { invariant, transaction } from '../db';
import { authorize, bookingScope, scope, type Actor, type Permission } from '../policy';
import { activeStatuses, nextStatus, quote } from '../workflow';
import { record, enqueue } from './shared';
import { decrypt, encrypt } from '../crypto';
import { limit } from '../auth';

type BookingInput = z.infer<typeof input.booking>;
type BookingCommand = z.infer<typeof input.bookingCommand>;

export async function createBooking(actor: Actor, value: BookingInput, key: string) {
  authorize(actor, 'booking:create');
  const tenant = scope(actor, value.branchId);
  const filter = { ...tenant, createdBy: actor.userId, requestKey: key };
  const requestHash = createHash('sha256').update(JSON.stringify(value)).digest('hex');
  function same<T extends { requestHash: string }>(previous: T) {
    invariant(previous.requestHash === requestHash, 409, 'KEY_CONFLICT', 'This request key was used for different booking details.');
    return previous;
  }
  return transaction(async () => {
    const previous = await Booking.findOne(filter);
    if (previous) return same(previous);
    // Serialize eligibility checks for bookings against the same connection.
    const connection = await Connection.findOneAndUpdate({
      ...tenant, id: value.connectionId, active: true,
      ...(actor.role === 'CUSTOMER' ? { customerId: actor.customerId } : {}),
    }, { $inc: { bookingVersion: 1 } }, { returnDocument: 'after' });
    invariant(connection, 404, 'CONNECTION_NOT_FOUND', 'An active connection was not found.');
    invariant(connection.productIds.includes(value.productId) && value.quantity <= connection.maxQuantity, 422, 'INELIGIBLE', 'The connection does not permit this product or quantity.');
    const existing = await Booking.exists({ ...tenant, connectionId: connection.id, status: { $in: activeStatuses } });
    invariant(!existing, 409, 'ACTIVE_BOOKING', 'This connection already has an active booking.');
    const cutoff = new Date(Date.now() - connection.refillIntervalDays * 86_400_000);
    if (connection.refillIntervalDays > 0) {
      const recent = await Booking.exists({ ...tenant, connectionId: connection.id, deliveredAt: { $gt: cutoff } });
      invariant(!recent, 409, 'REFILL_INTERVAL', 'The minimum refill interval has not elapsed.');
    }
    const customer = await Customer.findOne({ ...tenant, id: connection.customerId, active: true });
    const product = await Product.findOne({ ...tenant, id: value.productId, active: true });
    const price = await Price.findOne({ ...tenant, productId: value.productId, effectiveAt: { $lte: new Date() } }).sort({ effectiveAt: -1 });
    invariant(customer && product && price, 422, 'BOOKING_UNAVAILABLE', 'An active customer, product and effective price are required.');
    invariant(!value.preferredDate || value.preferredDate >= new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }), 422, 'PAST_DATE', 'Select today or a later delivery date.');
    const booking = await Booking.create({
      ...filter, requestHash, number: 'BK-' + randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase(),
      customerId: customer.id, customerName: customer.name, connectionId: connection.id, productId: product.id,
      productName: product.name, quantity: value.quantity, status: 'PENDING_VALIDATION',
      source: actor.role === 'CUSTOMER' ? 'CUSTOMER' : value.source, notes: value.notes,
      preferredDate: value.preferredDate, deliveryAddress: customer.toObject().address,
      price: quote(price.unit, price.taxBps, price.delivery, value.quantity),
    });
    await BookingEvent.create({ ...tenant, bookingId: booking.id, actorId: actor.userId, to: booking.status });
    await record(actor, booking.branchId, 'BOOKING_CREATED', booking.id);
    await enqueue(booking, 'BOOKING_CREATED');
    return booking;
  }).catch(async error => {
    if (error.code !== 11000) throw error;
    const previous = await Booking.findOne(filter);
    if (!previous) throw error;
    return same(previous);
  });
}

type StockBucket = 'filled' | 'empty' | 'reserved' | 'inTransit' | 'damaged' | 'quarantined';
type Deltas = Partial<Record<StockBucket, number>>;
type BalanceKey = { agencyId: string; branchId: string; warehouseId: string; productId: string };

export async function moveStock(key: BalanceKey, deltas: Deltas, actorId: string, action: string, context: { bookingId?: string; reason?: string } = {}) {
  await Balance.updateOne(key, { $setOnInsert: key }, { upsert: true });
  const conditions: { $gte: [string | { $subtract: [string, string] }, number] }[] = Object.entries(deltas)
    .filter(([, delta]) => delta < 0).map(([field, delta]) => ({ $gte: ['$' + field, -delta] }));
  const availableChange = (deltas.filled ?? 0) - (deltas.reserved ?? 0);
  if (availableChange < 0) conditions.push({ $gte: [{ $subtract: ['$filled', '$reserved'] }, -availableChange] });
  const balance = await Balance.findOneAndUpdate({ ...key, ...(conditions.length ? { $expr: { $and: conditions } } : {}) },
    { $inc: deltas }, { returnDocument: 'after' });
  invariant(balance, 409, 'INSUFFICIENT_STOCK', 'This movement would exceed available stock or driver custody.');
  await Movement.create({ ...key, ...context, deltas, actorId, action });
  return balance;
}

const permissions: Partial<Record<BookingCommand['action'], Permission>> = {
  allocate: 'inventory:write', assign: 'delivery:assign', dispatch: 'delivery:assign',
  complete: 'delivery:execute', fail: 'delivery:execute',
};

export async function transitionBooking(actor: Actor, id: string, command: BookingCommand) {
  authorize(actor, permissions[command.action] ?? 'booking:manage');
  if (command.action === 'complete') {
    const protectedBooking = await Booking.exists({ ...bookingScope(actor), id, status: 'OUT_FOR_DELIVERY', deliveryOtpRequired: true });
    if (protectedBooking) await limit('delivery-otp:' + actor.agencyId + ':' + id, 8, 15 * 60_000);
  }
  return transaction(async () => {
    const booking = await Booking.findOne({ ...bookingScope(actor), id }).select('+encryptedDeliveryOtp');
    invariant(booking, 404, 'BOOKING_NOT_FOUND', 'Booking not found.');
    const tenant = { agencyId: booking.agencyId, branchId: booking.branchId };
    const from = booking.status;
    const to = nextStatus(from, command.action, booking.holdFrom);
    const stock = (warehouseId: string) => ({ ...tenant, warehouseId, productId: booking.productId });
    const movement = (warehouseId: string, deltas: Deltas) =>
      moveStock(stock(warehouseId), deltas, actor.userId, command.action.toUpperCase(), { bookingId: id, reason: command.reason });

    if (['cancel', 'reject', 'hold', 'fail'].includes(command.action)) invariant(command.reason, 422, 'REASON_REQUIRED', 'Enter a reason for this action.');

    if (command.action === 'allocate') {
      const warehouse = command.warehouseId && await Warehouse.exists({ ...tenant, id: command.warehouseId });
      invariant(warehouse && command.warehouseId, 422, 'WAREHOUSE_REQUIRED', 'Select an eligible warehouse.');
      await movement(command.warehouseId, { reserved: booking.quantity });
      await Reservation.create({ ...stock(command.warehouseId), bookingId: id, quantity: booking.quantity, state: 'ACTIVE' });
      booking.warehouseId = command.warehouseId;
    }

    if (command.action === 'assign') {
      const agent = command.agentId && await Membership.exists({ agencyId: tenant.agencyId, branchIds: tenant.branchId, userId: command.agentId, role: 'DRIVER', active: true });
      const user = agent && await User.findOne({ id: command.agentId, active: true });
      invariant(user, 422, 'AGENT_REQUIRED', 'Select an active delivery agent in this branch.');
      await Assignment.create({ ...tenant, bookingId: id, agentId: user.id, state: 'ASSIGNED' });
      booking.agentId = user.id;
      booking.agentName = user.name;
    }

    if (command.action === 'dispatch' || (command.action === 'cancel' && ['ALLOCATED', 'READY_FOR_DISPATCH'].includes(from))) {
      invariant(booking.warehouseId, 409, 'NO_RESERVATION', 'A warehouse reservation is required.');
      const dispatch = command.action === 'dispatch';
      if (dispatch) {
        const active = await Assignment.exists({ ...tenant, bookingId: id, agentId: booking.agentId, state: 'ASSIGNED' });
        invariant(active, 409, 'NO_ASSIGNMENT', 'An active delivery assignment is required.');
        const branch = await Branch.findOne({ agencyId: tenant.agencyId, id: tenant.branchId }).select('deliveryOtp');
        booking.deliveryOtpRequired = Boolean(branch?.deliveryOtp);
        if (booking.deliveryOtpRequired) {
          const members = await Membership.find({ agencyId: tenant.agencyId, branchIds: tenant.branchId,
            customerId: booking.customerId, role: 'CUSTOMER', active: true }).select('userId').lean();
          invariant(await User.exists({ id: { $in: members.map(member => member.userId) }, active: true }),
            422, 'CUSTOMER_PORTAL_REQUIRED', 'Provision an active customer portal account before dispatching a delivery that requires a code.');
          booking.encryptedDeliveryOtp = encrypt(String(randomInt(0, 1_000_000)).padStart(6, '0'));
          booking.deliveryOtpExpiresAt = new Date(Date.now() + 48 * 3600_000);
        }
      }
      const result = await Reservation.updateOne({ ...tenant, bookingId: id, warehouseId: booking.warehouseId, state: 'ACTIVE', quantity: booking.quantity },
        { $set: { state: dispatch ? 'CONSUMED' : 'RELEASED' } });
      invariant(result.modifiedCount, 409, 'NO_RESERVATION', 'An active stock reservation is required.');
      await movement(booking.warehouseId, dispatch ?
        { reserved: -booking.quantity, filled: -booking.quantity, inTransit: booking.quantity } : { reserved: -booking.quantity });
      if (!dispatch) await Assignment.updateOne({ ...tenant, bookingId: id, state: 'ASSIGNED' }, { $set: { state: 'CANCELLED' } });
    }

    if (command.action === 'complete' || command.action === 'fail') {
      invariant(booking.warehouseId && booking.agentId, 409, 'NO_CUSTODY', 'A dispatched assignment is required.');
      const completed = command.action === 'complete';
      const result = await Assignment.updateOne({ ...tenant, bookingId: id, agentId: booking.agentId, state: 'ASSIGNED' },
        { $set: { state: completed ? 'DELIVERED' : 'FAILED' } });
      invariant(result.modifiedCount, 409, 'NO_CUSTODY', 'This assignment has already been reconciled.');
      if (completed) {
        invariant(command.recipient && command.delivered === booking.quantity && command.empties !== undefined && command.empties <= booking.quantity,
          422, 'PROOF_REQUIRED', 'Record the recipient, full delivered quantity, and number of empty cylinders collected.');
        if (booking.deliveryOtpRequired) {
          invariant(booking.encryptedDeliveryOtp && booking.deliveryOtpExpiresAt && booking.deliveryOtpExpiresAt > new Date(), 409,
            'DELIVERY_CODE_EXPIRED', 'The delivery code expired. Reconcile the return before dispatching another attempt.');
          invariant(command.otp && /^\d{6}$/.test(command.otp) &&
            timingSafeEqual(Buffer.from(command.otp), Buffer.from(decrypt(booking.encryptedDeliveryOtp))), 422,
            'DELIVERY_CODE_INVALID', 'Enter the valid delivery code from the customer portal.');
        }
        await Proof.create({ ...tenant, bookingId: id, agentId: booking.agentId, recipient: command.recipient,
          reference: command.reference, delivered: command.delivered, empties: command.empties,
          otpVerifiedAt: booking.deliveryOtpRequired ? new Date() : undefined });
        await movement(booking.warehouseId, { inTransit: -booking.quantity, empty: command.empties });
        await Invoice.create({ ...tenant, bookingId: id, number: booking.number.replace('BK-', 'INV-'), customerId: booking.customerId,
          customerName: booking.customerName, productName: booking.productName, quantity: booking.quantity,
          price: booking.toObject().price, status: booking.price.total ? 'OPEN' : 'PAID' });
        booking.deliveredAt = new Date();
      } else {
        invariant(command.returned === booking.quantity, 422, 'RETURN_REQUIRED', 'Confirm the full filled quantity has physically returned to the warehouse.');
        await movement(booking.warehouseId, { inTransit: -booking.quantity, filled: booking.quantity });
      }
      booking.encryptedDeliveryOtp = undefined;
      booking.deliveryOtpExpiresAt = undefined;
    }

    if (command.action === 'hold') booking.holdFrom = from;
    if (command.action === 'resume') booking.holdFrom = undefined;
    if (from === 'FAILED_DELIVERY' && command.action === 'confirm') {
      booking.agentId = undefined;
      booking.agentName = undefined;
      booking.warehouseId = undefined;
    }
    booking.status = to;
    await booking.save();
    await BookingEvent.create({ ...tenant, bookingId: id, actorId: actor.userId, from, to, reason: command.reason });
    await record(actor, booking.branchId, 'BOOKING_' + command.action.toUpperCase(), id, { from, to, reason: command.reason });
    await enqueue(booking, 'BOOKING_' + to);
    return booking;
  });
}
