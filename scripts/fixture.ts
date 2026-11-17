import { randomUUID } from 'node:crypto';
import { passwordHash } from '../src/server/auth';
import { migrate, transaction } from '../src/server/db';
import { createBooking, transitionBooking } from '../src/server/domain/bookings';
import { addPrice, addProduct, addWarehouse, changeStock, collectPayment, registerConnection, registerCustomer } from '../src/server/domain/operations';
import { Agency, Booking, Branch, Invoice, Membership, User } from '../src/server/models';
import type { Actor, Role } from '../src/server/policy';

export async function fixture(password: string, populated = false, { demo = false } = {}) {
  await migrate();
  const agencyId = randomUUID();
  const branchId = randomUUID();
  const suffix = populated ? '' : '-' + agencyId.slice(0, 8);
  const emails = { admin: 'admin' + suffix + '@cylinder.test', driver: 'driver' + suffix + '@cylinder.test', customer: 'customer' + suffix + '@cylinder.test' };
  const credentials = await passwordHash(password);
  const actors = await transaction(async () => {
    await Agency.create({ id: agencyId, name: populated ? 'Meridian Gas Agency' : 'Test agency' });
    await Branch.create({ id: branchId, agencyId, name: 'Central branch', code: 'CENTRAL' });
    async function provision(email: string, name: string, role: Role, customerId?: string): Promise<Actor> {
      const user = await User.create({ email, name, passwordHash: credentials, demo });
      const membership = await Membership.create({ agencyId, userId: user.id, branchIds: [branchId], role, customerId });
      return { userId: user.id, membershipId: membership.id, agencyId, branchIds: [branchId], name, role, customerId };
    }
    return {
      admin: await provision(emails.admin, 'Neha Mehta', 'OWNER'),
      driver: await provision(emails.driver, 'Arjun Patil', 'DRIVER'),
    };
  });
  const admin = actors.admin;
  const [domestic, commercial] = await Promise.all([
    addProduct(admin, { branchId, name: 'Domestic LPG · 14.2 kg', sku: 'LPG-142', weightKg: 14.2, category: 'DOMESTIC', lowStock: 15 }),
    addProduct(admin, { branchId, name: 'Commercial LPG · 19 kg', sku: 'LPG-190', weightKg: 19, category: 'COMMERCIAL', lowStock: 10 }),
  ]);
  const warehouse = await addWarehouse(admin, { branchId, name: 'Central warehouse', code: 'WH-CENTRAL' });
  await addPrice(admin, { branchId, productId: domestic.id, unit: 83500, taxBps: 500, delivery: 0, effectiveAt: '2024-01-01' });
  await addPrice(admin, { branchId, productId: commercial.id, unit: 162000, taxBps: 1800, delivery: 2000, effectiveAt: '2024-01-01' });
  for (const [productId, quantity] of [[domestic.id, populated ? 126 : 1], [commercial.id, 8]] as const) {
    await changeStock(admin, { branchId, warehouseId: warehouse.id, productId, quantity, bucket: 'filled', type: 'RECEIPT', reason: 'Opening stock' });
  }

  const makeCustomer = async (index: number, name: string, product = domestic) => {
    const customer = await registerCustomer(admin, { branchId, name, phone: '+919990000' + String(index).padStart(3, '0'),
      category: product.category as 'DOMESTIC' | 'COMMERCIAL',
      address: { line: (24 + index) + ' Lake View Road', city: 'Pune', state: 'Maharashtra', pincode: '411001' }, whatsappOptIn: false });
    const connection = await registerConnection(admin, { branchId, customerId: customer.id, productIds: [product.id],
      consumerNumber: 'CON-' + String(1001 + index), maxQuantity: 2, refillIntervalDays: 0 });
    return { customer, connection, product };
  };

  const first = await makeCustomer(0, 'Aditi Kulkarni');
  const second = await makeCustomer(1, 'Rohan Sharma');
  const user = await User.create({ email: emails.customer, name: first.customer.name, passwordHash: credentials, demo });
  const member = await Membership.create({ agencyId, userId: user.id, branchIds: [branchId], role: 'CUSTOMER', customerId: first.customer.id });
  const customerActor: Actor = { userId: user.id, name: user.name, membershipId: member.id, role: 'CUSTOMER',
    agencyId, branchIds: [branchId], customerId: first.customer.id };

  if (populated) {
    const names = ['Saanvi Shah', 'Milan Desai', 'Farah Khan', 'Vikram Nair', 'Priya Menon', 'Aarav Singh', 'Kavya Rao',
      'Nisha Joshi', 'Dev Verma', 'Mira Thomas', 'Raj Kapoor', 'Ananya Bose', 'Ravi Iyer', 'Leena Das', 'Tara Bhat', 'Kabir Gupta'];
    const stop = ['complete', 'dispatch', 'assign', 'allocate', 'confirm', 'pending'];
    for (const [index, name] of names.entries()) {
      const entry = await makeCustomer(index + 2, name, index % 5 === 4 ? commercial : domestic);
      const booking = await createBooking(admin, { branchId, connectionId: entry.connection.id, productId: entry.product.id,
        quantity: 1, source: index % 3 === 0 ? 'PHONE' : 'PORTAL' }, randomUUID());
      const limit = stop[index % stop.length];
      if (limit !== 'pending') {
        await transitionBooking(admin, booking.id, { action: 'confirm' });
        if (limit !== 'confirm') {
          await transitionBooking(admin, booking.id, { action: 'allocate', warehouseId: warehouse.id });
          if (limit !== 'allocate') {
            await transitionBooking(admin, booking.id, { action: 'assign', agentId: actors.driver.userId });
            if (limit !== 'assign') {
              await transitionBooking(admin, booking.id, { action: 'dispatch' });
              if (limit === 'complete') {
                await transitionBooking(actors.driver, booking.id, { action: 'complete', recipient: name, delivered: 1, empties: 1 });
                const invoice = await Invoice.findOne({ agencyId, bookingId: booking.id });
                if (invoice) await collectPayment(admin, { invoiceId: invoice.id, amount: invoice.price.total, mode: 'CASH' }, randomUUID());
              }
            }
          }
        }
      }
      const hours = [0, 2, 3, 25, 26, 48, 50, 52, 73, 75, 96, 97, 120, 121, 146, 147][index];
      const recorded = new Date(Date.now() - hours * 3600_000);
      await Booking.updateOne({ agencyId, id: booking.id }, { $set: { createdAt: recorded, ...(limit === 'complete' && hours >= 4 ?
        { deliveredAt: new Date(recorded.getTime() + 4 * 3600_000) } : {}) } }, { timestamps: false, overwriteImmutable: true });
    }
  }
  return { agencyId, branchId, admin, driver: actors.driver, customerActor, first, second, domestic, commercial, warehouse, emails };
}
