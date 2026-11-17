import { randomUUID } from 'node:crypto';
import { Branch, Customer, Integration, Outbox, Webhook } from '../models';
import { invariant, logger, transaction } from '../db';
import { decrypt } from '../crypto';
import { authorize, scope, type Actor } from '../policy';
import { record } from '../domain/shared';

export type WinqulyConfig = { apiBase: string; account: string; sender: string; credential: string; environment: string };
export type WinqulyInbound = { eventId: string; type: 'MESSAGE_STATUS' | 'INBOUND_MESSAGE'; account: string; branchId: string;
  externalId?: string; status?: 'DELIVERED' | 'READ' | 'FAILED'; content?: unknown };
export interface WinqulyContract {
  diagnose(config: WinqulyConfig, signal: AbortSignal): Promise<void>;
  sendTemplate(config: WinqulyConfig, message: { recipient: string; template: string; correlationId: string;
    event: string; entityId: string }, signal: AbortSignal): Promise<{ externalId: string }>;
  verifyWebhook(input: { config: WinqulyConfig; raw: string; headers: Headers; secret: string }): Promise<WinqulyInbound>;
}

export class ProviderFailure extends Error {
  constructor(public code: string, public retryable: boolean) { super(code); }
}

// Register the agency's verified contract here once provider documentation and fixtures are available.
export const winqulyContract: WinqulyContract | undefined = undefined as WinqulyContract | undefined;

function config(settings: { apiBase?: string | null; account?: string | null; sender?: string | null; environment?: string | null; encryptedCredential?: string | null }) {
  invariant(settings.apiBase && settings.account && settings.sender && settings.environment && settings.encryptedCredential,
    422, 'WINQULY_CONFIG_REQUIRED', 'Complete the integration configuration first.');
  return { apiBase: settings.apiBase, account: settings.account, sender: settings.sender,
    environment: settings.environment, credential: decrypt(settings.encryptedCredential) };
}

export async function testConnection(actor: Actor, contract = winqulyContract) {
  authorize(actor, 'integration:manage');
  invariant(contract, 503, 'WINQULY_CONTRACT_REQUIRED', 'Install the approved Winquly contract to run a live diagnostic.');
  const settings = await Integration.findOne({ agencyId: actor.agencyId }).select('+encryptedCredential');
  invariant(settings, 404, 'INTEGRATION_NOT_FOUND', 'Save integration settings first.');
  await contract.diagnose(config(settings), AbortSignal.timeout(8000));
  await Integration.updateOne({ agencyId: actor.agencyId }, { $set: { lastSuccessAt: new Date() } });
  return { connected: true };
}

export async function acceptWebhook(agencyId: string, raw: string, headers: Headers, contract = winqulyContract) {
  invariant(contract, 503, 'WINQULY_CONTRACT_REQUIRED', 'The approved webhook contract has not been configured.');
  const settings = await Integration.findOne({ agencyId, enabled: true }).select('+encryptedCredential +encryptedSigningSecret');
  invariant(settings?.encryptedSigningSecret, 404, 'INTEGRATION_NOT_FOUND', 'Webhook configuration not found.');
  const verified = await contract.verifyWebhook({ config: config(settings), raw, headers, secret: decrypt(settings.encryptedSigningSecret) });
  invariant(verified.account === settings.account && verified.eventId && verified.eventId.length <= 256 &&
    ['MESSAGE_STATUS', 'INBOUND_MESSAGE'].includes(verified.type), 422, 'UNMAPPED_EVENT', 'This event cannot be routed.');
  invariant(await Branch.exists({ agencyId, id: verified.branchId }), 422, 'UNMAPPED_BRANCH', 'This event cannot be routed.');
  try {
    await transaction(async () => {
      await Webhook.create({ agencyId, branchId: verified.branchId, providerEventId: verified.eventId,
        event: verified.type, payload: verified, status: 'PENDING' });
      await Integration.updateOne({ agencyId }, { $set: { lastWebhookAt: new Date() } });
    });
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
  }
  return { accepted: true };
}

export async function retryNotification(actor: Actor, id: string) {
  authorize(actor, 'integration:manage');
  return transaction(async () => {
    const job = await Outbox.findOneAndUpdate({ ...scope(actor), id, status: 'DEAD' },
      { $set: { status: 'PENDING', dueAt: new Date(), attempts: 0 }, $unset: { failure: 1 } }, { returnDocument: 'after' });
    invariant(job, 404, 'RETRY_UNAVAILABLE', 'Only dead-letter messages can be retried.');
    await record(actor, job.branchId, 'NOTIFICATION_RETRIED', job.id);
    return job;
  });
}

export async function processNotification(contract = winqulyContract) {
  const now = new Date();
  const leaseToken = randomUUID();
  const job = await Outbox.findOneAndUpdate({
    $or: [{ status: { $in: ['PENDING', 'RETRY'] }, dueAt: { $lte: now } }, { status: 'PROCESSING', leaseUntil: { $lte: now } }],
  }, { $set: { status: 'PROCESSING', leaseToken, leaseUntil: new Date(Date.now() + 60_000) }, $inc: { attempts: 1 } },
  { sort: { dueAt: 1, _id: 1 }, returnDocument: 'after' });
  if (!job) return false;
  const guard = { id: job.id, agencyId: job.agencyId, branchId: job.branchId, leaseToken, status: 'PROCESSING' };
  let result: { status: string; failure?: string; dueAt?: Date; externalId?: string };
  try {
    if (job.attempts > 8) throw new ProviderFailure('ATTEMPTS_EXHAUSTED', false);
    const settings = await Integration.findOne({ agencyId: job.agencyId }).select('+encryptedCredential');
    const customer = await Customer.findOne({ agencyId: job.agencyId, branchId: job.branchId, id: job.customerId, active: true }).lean();
    const template = settings?.templates?.get(job.event);
    if (!settings?.enabled || !customer?.whatsappOptInAt || !template) {
      result = { status: 'SKIPPED', failure: !settings?.enabled ? 'INTEGRATION_DISABLED' : !customer?.whatsappOptInAt ? 'NO_OPT_IN' : 'NO_TEMPLATE' };
    } else {
      if (!contract) throw new ProviderFailure('CONTRACT_REQUIRED', false);
      const response = await contract.sendTemplate(config(settings), { recipient: customer.phone, template,
        correlationId: job.id, event: job.event, entityId: job.entityId }, AbortSignal.timeout(10_000));
      if (!response.externalId) throw new ProviderFailure('MISSING_MESSAGE_ID', false);
      result = { status: 'SENT', externalId: response.externalId };
    }
  } catch (error) {
    const failure = error instanceof ProviderFailure ? error : new ProviderFailure('SEND_FAILED', true);
    const retry = failure.retryable && job.attempts < 8;
    result = { status: retry ? 'RETRY' : 'DEAD', failure: failure.code,
      dueAt: new Date(Date.now() + Math.min(3600_000, 15_000 * 2 ** (job.attempts - 1))) };
    logger.warn({ eventId: job.id, code: failure.code, retry }, 'Notification attempt did not succeed');
  }
  await Outbox.updateOne(guard, { $set: result, $unset: { leaseUntil: 1, leaseToken: 1, ...(!result.failure ? { failure: 1 } : {}) } });
  return true;
}

export async function processWebhook() {
  return transaction(async () => {
    const job = await Webhook.findOne({ status: 'PENDING' }).sort({ _id: 1 });
    if (!job) return false;
    const payload = job.payload as WinqulyInbound;
    if (payload.type === 'MESSAGE_STATUS' && payload.externalId && payload.status) {
      const prior = { DELIVERED: ['SENT', 'PROVIDER_FAILED'], READ: ['SENT', 'DELIVERED', 'PROVIDER_FAILED'], FAILED: ['SENT'] }[payload.status];
      const match = { agencyId: job.agencyId, branchId: job.branchId, externalId: payload.externalId };
      const status = payload.status === 'FAILED' ? 'PROVIDER_FAILED' : payload.status;
      if (prior && await Outbox.exists(match)) {
        await Outbox.updateOne({ ...match, status: { $in: prior } }, { $set: { status } });
        job.status = 'PROCESSED';
      } else job.status = 'QUARANTINED';
    } else job.status = 'NEEDS_HANDOFF';
    await job.save();
    return true;
  });
}
