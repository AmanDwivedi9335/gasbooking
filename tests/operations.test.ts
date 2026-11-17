import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { fixture } from '../scripts/fixture';
import { createBooking, transitionBooking } from '../src/server/domain/bookings';
import { collectPayment } from '../src/server/domain/operations';
import { bookingDetail } from '../src/server/domain/queries';
import { Balance, Booking, Customer, Invoice, Movement, Outbox, Proof, Reservation, Webhook } from '../src/server/models';
import { acceptWebhook, processNotification, processWebhook, ProviderFailure, testConnection, type WinqulyContract } from '../src/server/integrations/winquly';
import { Problem } from '../src/server/db';
import { changeStock, requestReconciliation, reviewReconciliation, saveIntegration } from '../src/server/domain/operations';

let database: MongoMemoryReplSet;
let seed: Awaited<ReturnType<typeof fixture>>;
before(async () => {
  if (!process.env.TEST_MONGODB_URI) database = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  process.env.MONGODB_URI = process.env.TEST_MONGODB_URI ?? database.getUri();
  seed = await fixture('test-password-long-001');
});
after(async () => { await mongoose.disconnect(); await database?.stop(); });

test('tenant-scoped booking lifecycle preserves inventory and finance under contention', async () => {
  const { agencyId, branchId, admin, driver, customerActor, first, second, warehouse, domestic } = seed;
  const input = { branchId, connectionId: first.connection.id, productId: domestic.id, quantity: 1, source: 'PORTAL' as const };
  const key = randomUUID();
  const a = await createBooking(customerActor, input, key);
  assert.equal((await createBooking(customerActor, input, key)).id, a.id);
  await assert.rejects(createBooking(customerActor, { ...input, quantity: 2 }, key), { code: 'KEY_CONFLICT' });
  await assert.rejects(createBooking(customerActor, { ...input, connectionId: second.connection.id }, randomUUID()), { code: 'CONNECTION_NOT_FOUND' });
  const b = await createBooking(admin, { ...input, connectionId: second.connection.id }, randomUUID());
  await assert.rejects(bookingDetail(customerActor, b.id), { code: 'BOOKING_NOT_FOUND' });
  await transitionBooking(admin, a.id, { action: 'confirm' });
  await transitionBooking(admin, b.id, { action: 'confirm' });
  const allocate = { action: 'allocate', warehouseId: warehouse.id } as const;
  const competing = await Promise.allSettled([transitionBooking(admin, a.id, allocate), transitionBooking(admin, b.id, allocate)]);
  assert.equal(competing.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = competing.find(result => result.status === 'rejected');
  assert.equal(rejected?.reason.code, 'INSUFFICIENT_STOCK');
  const winner = competing.findIndex(result => result.status === 'fulfilled') === 0 ? a : b;
  const loser = winner.id === a.id ? b : a;
  const stock = { agencyId, branchId, warehouseId: warehouse.id, productId: domestic.id };
  assert.equal((await Balance.findOne(stock))?.reserved, 1);
  await transitionBooking(admin, winner.id, { action: 'cancel', reason: 'Customer cancelled' });
  await assert.rejects(transitionBooking(admin, winner.id, { action: 'cancel', reason: 'Retry' }), Problem);
  assert.equal(await Reservation.countDocuments({ agencyId, bookingId: winner.id, state: 'RELEASED' }), 1);
  await transitionBooking(admin, loser.id, allocate);
  await transitionBooking(admin, loser.id, { action: 'assign', agentId: driver.userId });
  await transitionBooking(admin, loser.id, { action: 'dispatch' });
  await assert.rejects(transitionBooking(driver, loser.id, { action: 'complete', delivered: 0, empties: 0 }), { code: 'PROOF_REQUIRED' });
  assert.equal((await Balance.findOne(stock))?.inTransit, 1);
  assert.equal(await Proof.countDocuments({ agencyId, bookingId: loser.id }), 0);
  await transitionBooking(driver, loser.id, { action: 'complete', recipient: 'Customer', delivered: 1, empties: 1 });
  const balance = await Balance.findOne(stock);
  assert.deepEqual([balance?.filled, balance?.reserved, balance?.inTransit, balance?.empty], [0, 0, 0, 1]);
  assert.equal(await Movement.countDocuments({ agencyId, bookingId: loser.id }), 3);
  const invoice = await Invoice.findOne({ agencyId, bookingId: loser.id });
  assert.ok(invoice);
  await assert.rejects(collectPayment(driver, { invoiceId: invoice.id, amount: invoice.price.total + 1, mode: 'CASH' }, randomUUID()), { code: 'PAYMENT_EXCEEDS_BALANCE' });
  const paymentKey = randomUUID();
  const payment = await collectPayment(driver, { invoiceId: invoice.id, amount: invoice.price.total, mode: 'CASH' }, paymentKey);
  assert.equal((await collectPayment(driver, { invoiceId: invoice.id, amount: invoice.price.total, mode: 'CASH' }, paymentKey)).id, payment.id);
  assert.equal((await Invoice.findOne({ id: invoice.id }))?.status, 'PAID');
  assert.equal((await Booking.findOne({ id: loser.id }))?.status, 'DELIVERED');
  assert.equal(await Outbox.countDocuments({ agencyId, entityId: payment.id, event: 'PAYMENT_RECEIVED' }), 1);
});

test('worker recovers expired leases and persists the resulting diagnostic', async () => {
  const job = await Outbox.create({ agencyId: seed.agencyId, branchId: seed.branchId, customerId: seed.first.customer.id,
    event: 'BOOKING_CREATED', entityId: randomUUID(), status: 'PROCESSING', leaseToken: 'expired', attempts: 1, dueAt: new Date(0), leaseUntil: new Date(0) });
  assert.equal(await processNotification(), true);
  const result = await Outbox.findOne({ id: job.id });
  assert.equal(result?.status, 'SKIPPED');
  assert.equal(result?.failure, 'INTEGRATION_DISABLED');
  assert.equal(result?.attempts, 2);
  assert.equal(result?.leaseToken, undefined);
});

test('physical stock variances require independent review and a current baseline', async () => {
  const { agencyId, branchId, admin, driver, commercial, warehouse } = seed;
  const key = { agencyId, branchId, warehouseId: warehouse.id, productId: commercial.id };
  const reviewer = { ...driver, role: 'BRANCH_MANAGER' as const };
  const count = { ...key, counted: { filled: 7, empty: 1, damaged: 0, quarantined: 0 }, reason: 'Physical count' };
  const first = await requestReconciliation(admin, count);
  await assert.rejects(reviewReconciliation(admin, first.id, { decision: 'APPROVED', note: 'Reviewed' }), { code: 'INDEPENDENT_REVIEW_REQUIRED' });
  await changeStock(admin, { ...key, bucket: 'filled', quantity: 1, type: 'RECEIPT', reason: 'Supplier receipt' });
  await assert.rejects(reviewReconciliation(reviewer, first.id, { decision: 'APPROVED', note: 'Reviewed' }), { code: 'STALE_COUNT' });
  await reviewReconciliation(reviewer, first.id, { decision: 'REJECTED', note: 'New receipt' });
  const second = await requestReconciliation(admin, count);
  await reviewReconciliation(reviewer, second.id, { decision: 'APPROVED', note: 'Verified quantities' });
  const balance = await Balance.findOne(key);
  assert.deepEqual([balance?.filled, balance?.empty], [7, 1]);
  assert.equal(await Movement.countDocuments({ ...key, action: 'RECONCILIATION' }), 1);
});

test('provider boundary retries a transient send and deduplicates verified callbacks', async () => {
  const { agencyId, branchId, admin, first } = seed;
  process.env.CREDENTIAL_KEY = randomBytes(32).toString('base64');
  await saveIntegration(admin, { enabled: true, environment: 'SANDBOX', apiBase: 'https://provider.invalid',
    account: 'test-account', sender: 'test-sender', credential: 'fixture-credential',
    signingSecret: 'internal-fixture-secret', templates: { TEST_EVENT: 'approved-test-template' } });
  await Customer.updateOne({ agencyId, branchId, id: first.customer.id }, { $set: { whatsappOptInAt: new Date() } });
  const job = await Outbox.create({ agencyId, branchId, customerId: first.customer.id, event: 'TEST_EVENT',
    entityId: randomUUID(), dueAt: new Date(0), status: 'PENDING' });
  const externalId = randomUUID();
  const eventId = randomUUID();
  const correlations: string[] = [];
  const contract: WinqulyContract = {
    async diagnose(config) { assert.equal(config.credential, 'fixture-credential'); },
    async sendTemplate(_config, message) {
      assert.equal(message.template, 'approved-test-template');
      correlations.push(message.correlationId);
      if (correlations.length === 1) throw new ProviderFailure('FIXTURE_TRANSIENT', true);
      return { externalId };
    },
    async verifyWebhook({ raw, secret }) {
      // Exercise the internal adapter boundary. This fixture represents no provider wire format.
      if (raw !== 'verified-fixture' || secret !== 'internal-fixture-secret') throw new Problem(401, 'INVALID_SIGNATURE', 'Invalid test signature.');
      return { eventId, type: 'MESSAGE_STATUS', account: 'test-account', branchId, externalId, status: 'READ' };
    },
  };
  assert.deepEqual(await testConnection(admin, contract), { connected: true });
  await processNotification(contract);
  assert.equal((await Outbox.findOne({ id: job.id }))?.status, 'RETRY');
  await Outbox.updateOne({ id: job.id }, { $set: { dueAt: new Date(0) } });
  await processNotification(contract);
  assert.equal((await Outbox.findOne({ id: job.id }))?.externalId, externalId);
  assert.deepEqual(correlations, [job.id, job.id]);
  await assert.rejects(acceptWebhook(agencyId, 'invalid-fixture', new Headers(), contract), { code: 'INVALID_SIGNATURE' });
  await Promise.all([acceptWebhook(agencyId, 'verified-fixture', new Headers(), contract),
    acceptWebhook(agencyId, 'verified-fixture', new Headers(), contract)]);
  assert.equal(await Webhook.countDocuments({ agencyId, providerEventId: eventId }), 1);
  assert.equal(await processWebhook(), true);
  assert.equal((await Outbox.findOne({ id: job.id }))?.status, 'READ');
});
