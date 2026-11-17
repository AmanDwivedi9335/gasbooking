import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { currentActor, limit, signIn, signOut, workspace } from '@/server/auth';
import { connect, invariant, logger, Problem } from '@/server/db';
import * as S from '@/server/schemas';
import * as Q from '@/server/domain/queries';
import * as O from '@/server/domain/operations';
import { createBooking, transitionBooking } from '@/server/domain/bookings';
import { authorize, type Actor } from '@/server/policy';
import { Integration } from '@/server/models';
import { acceptWebhook, retryNotification, testConnection } from '@/server/integrations/winquly';

const query = z.object({
  branchId: S.uuid.optional(), cursor: z.string().regex(/^[a-f0-9]{24}$/i).optional(),
  status: z.string().max(40).optional(), search: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25), from: S.date.optional(), to: S.date.optional(),
});

function idempotency(request: NextRequest) {
  const value = request.headers.get('idempotency-key');
  invariant(value && /^[a-zA-Z0-9_-]{12,100}$/.test(value), 400, 'IDEMPOTENCY_KEY_REQUIRED', 'Provide a valid Idempotency-Key header.');
  return value;
}

async function raw(request: NextRequest, max = 128_000) {
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (!reader) return '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw new Problem(413, 'BODY_TOO_LARGE', 'The request body is too large.');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function body(request: NextRequest) {
  invariant(request.headers.get('content-type')?.split(';')[0].trim() === 'application/json', 415, 'CONTENT_TYPE', 'Send a JSON request.');
  const text = await raw(request);
  try { return JSON.parse(text); } catch { throw new Problem(400, 'INVALID_JSON', 'The request body is invalid JSON.'); }
}

function protectOrigin(request: NextRequest) {
  const origin = process.env.APP_ORIGIN ?? (process.env.NODE_ENV === 'production' ? undefined : request.nextUrl.origin);
  invariant(origin && request.headers.get('origin') === new URL(origin).origin, 403, 'ORIGIN_DENIED', 'The request origin is not permitted.');
}

const dateInIndia = (date: Date) => date.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

async function read(actor: Actor, path: string[], request: NextRequest) {
  const [resource, id, operation] = path;
  const options = query.parse(Object.fromEntries(request.nextUrl.searchParams));
  if (resource === 'me' && !id) return { actor, ...await workspace(actor) };
  if (resource === 'bookings' && !operation) return id ? Q.bookingDetail(actor, S.uuid.parse(id)) : Q.bookings(actor, options);
  if (resource === 'deliveries' && id === 'agents' && !operation) return Q.agents(actor, options.branchId);
  if (resource === 'inventory' && id && !operation && ['balances', 'movements', 'warehouses'].includes(id) && Q.isListing(id)) return Q.list(actor, id, options);
  if (resource === 'staff' && !id) return Q.staff(actor, options.branchId);
  if (resource === 'reports' && id === 'dashboard' && !operation) {
    return Q.dashboard(actor, options.branchId, options.from ?? dateInIndia(new Date(Date.now() - 6 * 86_400_000)), options.to ?? dateInIndia(new Date()));
  }
  if (resource === 'integrations' && id === 'winquly' && !operation) {
    authorize(actor, 'integration:manage');
    const settings = await Integration.findOne({ agencyId: actor.agencyId }).select('+encryptedCredential +encryptedSigningSecret');
    if (!settings) return null;
    const { encryptedCredential, encryptedSigningSecret, ...fields } = settings.toObject({ flattenMaps: true });
    return { ...fields, hasCredential: Boolean(encryptedCredential), hasSigningSecret: Boolean(encryptedSigningSecret) };
  }
  if (!id && Q.isListing(resource)) return Q.list(actor, resource, options);
  throw new Problem(404, 'NOT_FOUND', 'Endpoint not found.');
}

async function write(actor: Actor, path: string[], request: NextRequest) {
  const [resource, id, operation] = path;
  const value = await body(request);
  if (resource === 'bookings') {
    if (!id) return createBooking(actor, S.booking.parse(value), idempotency(request));
    return transitionBooking(actor, S.uuid.parse(id), S.bookingCommand.parse({ ...value, ...(operation ? { action: operation } : {}) }));
  }
  if (resource === 'deliveries' && id && operation) return transitionBooking(actor, S.uuid.parse(id), S.bookingCommand.parse({ ...value, action: operation }));
  if (resource === 'inventory' && id === 'transfers' && !operation) return O.changeStock(actor, S.stock.parse({ ...value, type: 'TRANSFER' }));
  if (resource === 'inventory' && id === 'movements' && !operation) return O.changeStock(actor, S.stock.parse(value));
  if (resource === 'inventory' && id === 'reconciliation') {
    if (operation) return O.reviewReconciliation(actor, S.uuid.parse(operation), S.reconciliationReview.parse(value));
    return O.requestReconciliation(actor, S.reconciliation.parse(value));
  }
  if (resource === 'integrations' && id === 'winquly') {
    if (operation === 'test') return testConnection(actor);
    if (!operation) return O.saveIntegration(actor, S.integration.parse(value));
  }
  if (resource === 'communications' && id && operation === 'retry') return retryNotification(actor, S.uuid.parse(id));
  if (resource === 'customers' && id && !operation) return O.updateCustomer(actor, S.uuid.parse(id), S.customer.parse(value));
  if (resource === 'branches' && id && !operation) return O.updateBranch(actor, S.uuid.parse(id), S.branchSettings.parse(value));
  if (resource === 'complaints' && id && !operation) return O.updateComplaint(actor, S.uuid.parse(id), S.complaintUpdate.parse(value));
  if (!id) {
    switch (resource) {
      case 'customers': return O.registerCustomer(actor, S.customer.parse(value));
      case 'connections': return O.registerConnection(actor, S.connection.parse(value));
      case 'products': return O.addProduct(actor, S.product.parse(value));
      case 'prices': return O.addPrice(actor, S.price.parse(value));
      case 'warehouses': return O.addWarehouse(actor, S.warehouse.parse(value));
      case 'payments': return O.collectPayment(actor, S.payment.parse(value), idempotency(request));
      case 'complaints': return O.createComplaint(actor, S.complaint.parse(value));
      case 'staff': return O.addStaff(actor, S.staff.parse(value));
      case 'branches': return O.addBranch(actor, S.branch.parse(value));
    }
  }
  throw new Problem(404, 'NOT_FOUND', 'Endpoint not found.');
}

type Context = { params: Promise<{ route: string[] }> };

async function handle(request: NextRequest, context: Context) {
  const requestId = randomUUID();
  const response = (value: unknown, status: number) => NextResponse.json(value, { status, headers: {
    'Cache-Control': 'private, no-store', 'X-Request-Id': requestId,
  } });
  try {
    const { route } = await context.params;
    invariant(route.length <= 3, 404, 'NOT_FOUND', 'Endpoint not found.');
    const key = route.join('/');
    const isPost = request.method === 'POST';
    if (key === 'health' && !isPost) {
      const database = await connect();
      const topology = await database.connection.db?.admin().command({ hello: 1 });
      invariant(topology?.isWritablePrimary && topology.setName, 503, 'DB_NOT_READY', 'A writable MongoDB replica set is required.');
      return response({ data: { ready: true } }, 200);
    }
    if (key === 'integrations/winquly/webhook' && isPost) {
      await connect();
      const agencyId = S.uuid.parse(request.nextUrl.searchParams.get('agency'));
      return response({ data: await acceptWebhook(agencyId, await raw(request), request.headers) }, 202);
    }
    if (isPost) protectOrigin(request);
    if (key === 'auth/login' && isPost) {
      const actor = await signIn(S.login.parse(await body(request)));
      return response({ data: { role: actor.role } }, 200);
    }
    const actor = await currentActor();
    invariant(actor, 401, 'AUTH_REQUIRED', 'Sign in to continue.');
    await limit('api:' + actor.userId, 600, 60_000);
    if (key === 'auth/logout' && isPost) {
      await signOut();
      return response({ data: { signedOut: true } }, 200);
    }
    const data = isPost ? await write(actor, route, request) : await read(actor, route, request);
    return response({ data: Q.clean(data) }, 200);
  } catch (error) {
    if (error instanceof Problem) return response({ error: { code: error.code, message: error.message } }, error.status);
    if (error instanceof z.ZodError) return response({ error: { code: 'INVALID_INPUT', message: error.issues[0]?.message ?? 'Check the request fields.',
      fields: error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })) } }, 422);
    if ((error as { code?: number }).code === 11000) return response({ error: { code: 'DUPLICATE_RECORD', message: 'A record with that unique value already exists.' } }, 409);
    logger.error({ requestId, type: (error as Error).name }, 'API request failed');
    return response({ error: { code: 'UNEXPECTED_ERROR', message: 'The request could not be completed.' } }, 500);
  }
}

export const GET = handle;
export const POST = handle;
