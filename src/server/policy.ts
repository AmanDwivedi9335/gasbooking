import { invariant } from './db';

export const permissions = [
  'dashboard:read', 'customer:read', 'customer:write', 'catalog:read', 'catalog:write', 'booking:read', 'booking:create',
  'booking:manage', 'inventory:read', 'inventory:write', 'inventory:approve', 'delivery:assign', 'delivery:execute', 'finance:read',
  'finance:collect', 'support:read', 'support:write', 'support:manage', 'reports:read', 'staff:manage', 'integration:manage', 'audit:read',
] as const;
export type Permission = typeof permissions[number];
export const roles = {
  OWNER: permissions,
  BRANCH_MANAGER: permissions.filter(permission => !['staff:manage', 'integration:manage'].includes(permission)),
  OPERATOR: ['dashboard:read', 'customer:read', 'customer:write', 'catalog:read', 'booking:read', 'booking:create', 'booking:manage', 'support:read', 'support:write'],
  INVENTORY: ['dashboard:read', 'catalog:read', 'booking:read', 'booking:manage', 'inventory:read', 'inventory:write'],
  SUPERVISOR: ['dashboard:read', 'customer:read', 'catalog:read', 'booking:read', 'booking:manage', 'inventory:read', 'delivery:assign', 'delivery:execute'],
  DRIVER: ['booking:read', 'delivery:execute', 'finance:collect'],
  ACCOUNTS: ['dashboard:read', 'booking:read', 'finance:read', 'finance:collect', 'reports:read'],
  CUSTOMER: ['customer:read', 'catalog:read', 'booking:read', 'booking:create', 'finance:read', 'support:read', 'support:write'],
} satisfies Record<string, readonly Permission[]>;

export type Role = keyof typeof roles;
export type Actor = { userId: string; membershipId: string; agencyId: string; branchIds: string[]; role: Role; name: string; customerId?: string };

export function allowed(actor: Actor, permission: Permission) {
  return (roles[actor.role] as readonly Permission[]).includes(permission);
}

export function authorize(actor: Actor, permission: Permission) {
  invariant(allowed(actor, permission), 403, 'FORBIDDEN', 'Your role cannot perform this action.');
}

export function scope(actor: Actor, branchId: string): { agencyId: string; branchId: string };
export function scope(actor: Actor, branchId?: string): { agencyId: string; branchId: string | { $in: string[] } };
export function scope(actor: Actor, branchId?: string) {
  invariant(!branchId || actor.branchIds.includes(branchId), 403, 'BRANCH_FORBIDDEN', 'You do not have access to this branch.');
  return { agencyId: actor.agencyId, branchId: branchId ?? { $in: actor.branchIds } };
}

export function bookingScope(actor: Actor, branchId?: string) {
  return {
    ...scope(actor, branchId),
    ...(actor.role === 'CUSTOMER' ? { customerId: actor.customerId! } : {}),
    ...(actor.role === 'DRIVER' ? { agentId: actor.userId } : {}),
  };
}

export const roleNames: Record<Role, string> = {
  OWNER: 'Agency administrator', BRANCH_MANAGER: 'Branch manager', OPERATOR: 'Booking operator', INVENTORY: 'Inventory manager',
  SUPERVISOR: 'Delivery supervisor', DRIVER: 'Delivery agent', ACCOUNTS: 'Accounts manager', CUSTOMER: 'Customer',
};
