import { invariant } from './db';

export const transitions = {
  DRAFT: { submit: 'PENDING_VALIDATION', cancel: 'CANCELLED' },
  PENDING_VALIDATION: { confirm: 'CONFIRMED', reject: 'REJECTED', hold: 'ON_HOLD', cancel: 'CANCELLED' },
  CONFIRMED: { allocate: 'ALLOCATED', hold: 'ON_HOLD', cancel: 'CANCELLED' },
  ALLOCATED: { assign: 'READY_FOR_DISPATCH', cancel: 'CANCELLED' },
  READY_FOR_DISPATCH: { dispatch: 'OUT_FOR_DELIVERY', cancel: 'CANCELLED' },
  OUT_FOR_DELIVERY: { complete: 'DELIVERED', fail: 'FAILED_DELIVERY' },
  FAILED_DELIVERY: { confirm: 'CONFIRMED', cancel: 'CANCELLED' },
  ON_HOLD: { cancel: 'CANCELLED' },
  DELIVERED: { close: 'CLOSED' },
  CLOSED: {},
  CANCELLED: {},
  REJECTED: {},
} as const;

export const activeStatuses = ['DRAFT', 'PENDING_VALIDATION', 'CONFIRMED', 'ALLOCATED', 'READY_FOR_DISPATCH', 'OUT_FOR_DELIVERY', 'FAILED_DELIVERY', 'ON_HOLD'];
export const statuses = Object.keys(transitions);
export const commands = ['submit', 'confirm', 'reject', 'hold', 'resume', 'cancel', 'allocate', 'assign', 'dispatch', 'complete', 'fail', 'close'] as const;
export type Command = typeof commands[number];

export function nextStatus(from: string, action: Command, holdFrom?: string | null) {
  if (from === 'ON_HOLD' && action === 'resume' && ['PENDING_VALIDATION', 'CONFIRMED'].includes(holdFrom ?? '')) return holdFrom!;
  const map = transitions[from as keyof typeof transitions] as Record<string, string> | undefined;
  const to = map?.[action];
  invariant(to, 409, 'INVALID_TRANSITION', 'This action is unavailable for the current booking status.');
  return to;
}

export function quote(unit: number, taxBps: number, delivery: number, quantity: number) {
  const subtotal = unit * quantity;
  const tax = Math.floor((subtotal * taxBps + 5000) / 10000);
  return { unit, subtotal, tax, delivery, total: subtotal + tax + delivery };
}

