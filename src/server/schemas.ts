import { z } from 'zod';
import { commands } from './workflow';
import { roles } from './policy';

export const uuid = z.uuid();
export const name = z.string().trim().min(2).max(120);
export const note = z.string().trim().max(1500);
export const phone = z.string().trim().regex(/^\+[1-9]\d{7,14}$/, 'Use an international number, such as +91 followed by ten digits.');
export const money = z.number().int().min(0).max(100_000_000);
export const category = z.enum(['DOMESTIC', 'COMMERCIAL']);
export const date = z.iso.date();
export const address = z.object({ line: name, city: name, state: name.optional(), pincode: z.string().trim().min(3).max(12),
  landmark: z.string().trim().max(120).optional(), instructions: note.optional() });
export const login = z.object({
  identifier: z.string().trim().toLowerCase().pipe(z.union([z.literal('admin'), z.email()])).optional(),
  email: z.email().transform(value => value.toLowerCase()).optional(), password: z.string().min(1).max(256),
  agency: uuid.optional(), otp: z.string().regex(/^\d{6}$/).optional(), workspace: z.enum(['app', 'portal', 'delivery']).optional(),
}).transform(({ identifier, email, ...rest }, ctx) => {
  const id = identifier ?? email;
  if (!id) {
    ctx.addIssue({ code: 'custom', path: ['identifier'], message: 'Enter a user ID or email address.' });
    return z.NEVER;
  }
  return { identifier: id, ...rest };
});
export const customer = z.object({ branchId: uuid, name, phone, alternatePhone: phone.optional(), email: z.email().optional(),
  category, address, whatsappOptIn: z.boolean().default(false) });
export const connection = z.object({ branchId: uuid, customerId: uuid, consumerNumber: name, provider: name.optional(),
  productIds: z.array(uuid).min(1).max(30), maxQuantity: z.number().int().min(1).max(100), refillIntervalDays: z.number().int().min(0).max(365) });
export const product = z.object({ branchId: uuid, name, sku: name, weightKg: z.number().positive().max(1000), category, lowStock: z.number().int().min(0).max(10000) });
export const price = z.object({ branchId: uuid, productId: uuid, unit: money, taxBps: z.number().int().min(0).max(10000), delivery: money, effectiveAt: date });
export const warehouse = z.object({ branchId: uuid, name, code: name });
export const branch = z.object({ name, code: name });
export const branchSettings = z.object({ deliveryOtp: z.boolean() });
export const booking = z.object({ branchId: uuid, connectionId: uuid, productId: uuid, quantity: z.number().int().min(1).max(100),
  preferredDate: date.optional(), notes: note.optional(), source: z.enum(['PORTAL', 'PHONE']).default('PORTAL') });
export const bookingCommand = z.object({ action: z.enum(commands), reason: name.optional(), warehouseId: uuid.optional(),
  agentId: uuid.optional(), recipient: name.optional(), reference: note.optional(), delivered: z.number().int().min(0).max(100).optional(),
  empties: z.number().int().min(0).max(100).optional(), returned: z.number().int().min(0).max(100).optional(),
  otp: z.string().regex(/^\d{6}$/, 'Enter the six-digit delivery code.').optional() });
export const stock = z.object({ branchId: uuid, warehouseId: uuid, productId: uuid, reason: name,
  type: z.enum(['RECEIPT', 'TRANSFER']), bucket: z.enum(['filled', 'empty', 'damaged', 'quarantined']),
  quantity: z.number().int().min(1).max(10000), toWarehouseId: uuid.optional() });
const physical = z.number().int().min(0).max(1_000_000);
export const reconciliation = z.object({ branchId: uuid, warehouseId: uuid, productId: uuid, reason: note.min(2),
  counted: z.object({ filled: physical, empty: physical, damaged: physical, quarantined: physical }) });
export const reconciliationReview = z.object({ decision: z.enum(['APPROVED', 'REJECTED']), note: note.min(2) });
export const payment = z.object({ invoiceId: uuid, amount: money.refine(value => value > 0), mode: z.enum(['CASH', 'UPI']), reference: name.optional() });
export const complaint = z.object({ branchId: uuid, customerId: uuid.optional(), subject: name, description: note.min(5),
  category: z.enum(['BOOKING', 'DELIVERY', 'BILLING', 'PAYMENT', 'CYLINDER', 'QUANTITY', 'CONNECTION', 'GENERAL', 'SAFETY']) });
export const complaintUpdate = z.object({ status: z.enum(['IN_PROGRESS', 'RESOLVED', 'OPEN']), note: note.min(2) });
export const staff = z.object({ branchId: uuid, name, email: z.email().transform(value => value.toLowerCase()),
  role: z.enum(Object.keys(roles) as [keyof typeof roles]), password: z.string().min(14).max(256),
  customerId: uuid.optional(), mfaSecret: z.string().regex(/^[A-Z2-7]{16,128}$/).optional() });
export const integration = z.object({ enabled: z.boolean(), environment: z.enum(['SANDBOX', 'PRODUCTION']),
  apiBase: z.url().refine(value => new URL(value).protocol === 'https:' && !new URL(value).username && !new URL(value).password),
  account: name, sender: name, credential: z.string().min(8).max(4096).optional(), signingSecret: z.string().min(16).max(4096).optional(),
  templates: z.record(z.string().regex(/^[A-Z][A-Z0-9_]{1,80}$/), name).default({}) });

