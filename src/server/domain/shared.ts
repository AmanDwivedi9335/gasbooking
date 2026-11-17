import { Audit, Outbox } from '../models';
import type { Actor } from '../policy';

export async function record(actor: Actor, branchId: string, action: string, entityId: string, detail?: object) {
  await Audit.create({ agencyId: actor.agencyId, branchId, actorId: actor.userId, action, entityId, detail });
}

export async function enqueue(entity: { agencyId: string; branchId: string; id: string; customerId: string }, event: string) {
  await Outbox.create({ agencyId: entity.agencyId, branchId: entity.branchId, entityId: entity.id,
    customerId: entity.customerId, event, status: 'PENDING', dueAt: new Date() });
}
