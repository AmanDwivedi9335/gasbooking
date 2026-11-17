import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { decrypt, encrypt } from '../src/server/crypto';
import { Problem } from '../src/server/db';
import { allowed, bookingScope, scope, type Actor } from '../src/server/policy';
import { nextStatus, quote } from '../src/server/workflow';

test('booking state machine guards dispatch, completion, release and resume', () => {
  assert.throws(() => nextStatus('CONFIRMED', 'dispatch'), Problem);
  assert.throws(() => nextStatus('READY_FOR_DISPATCH', 'complete'), Problem);
  assert.throws(() => nextStatus('DELIVERED', 'cancel'), Problem);
  assert.equal(nextStatus('ALLOCATED', 'cancel'), 'CANCELLED');
  assert.equal(nextStatus('ON_HOLD', 'resume', 'CONFIRMED'), 'CONFIRMED');
});

test('quotes apply integer paise and round tax once', () => {
  assert.deepEqual(quote(83500, 500, 2000, 2), { unit: 83500, subtotal: 167000, tax: 8350, delivery: 2000, total: 177350 });
  assert.equal(quote(105, 1000, 0, 1).tax, 11);
});

test('customer and driver access scopes are restrictive', () => {
  const actor: Actor = { userId: 'driver-a', name: 'Driver', membershipId: 'member', agencyId: 'agency', branchIds: ['central'], role: 'DRIVER' };
  assert.deepEqual(bookingScope(actor), { agencyId: 'agency', branchId: { $in: ['central'] }, agentId: 'driver-a' });
  assert.equal(allowed(actor, 'delivery:execute'), true);
  assert.equal(allowed(actor, 'delivery:assign'), false);
  assert.throws(() => scope(actor, 'other'), Problem);
  assert.deepEqual(bookingScope({ ...actor, role: 'CUSTOMER', customerId: 'owner' }), { agencyId: 'agency', branchId: { $in: ['central'] }, customerId: 'owner' });
});

test('credential encryption authenticates stored secrets', () => {
  process.env.CREDENTIAL_KEY = randomBytes(32).toString('base64');
  const encrypted = encrypt('secret-value');
  assert.equal(decrypt(encrypted), 'secret-value');
  const [iv, tag, ciphertext] = encrypted.split('.');
  const altered = Buffer.from(ciphertext, 'base64url');
  altered[0] ^= 1;
  assert.throws(() => decrypt([iv, tag, altered.toString('base64url')].join('.')));
});
