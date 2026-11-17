import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { z } from 'zod';
import { passwordHash } from '../src/server/auth';
import { encrypt } from '../src/server/crypto';
import { migrate, transaction } from '../src/server/db';
import { Agency, Branch, Membership, User } from '../src/server/models';

async function bootstrap() {
  const input = z.object({
    BOOTSTRAP_AGENCY: z.string().trim().min(2).max(120), BOOTSTRAP_BRANCH: z.string().trim().min(2).max(120),
    BOOTSTRAP_OWNER_NAME: z.string().trim().min(2).max(120), BOOTSTRAP_OWNER_EMAIL: z.email(),
    BOOTSTRAP_OWNER_PASSWORD: z.string().min(14).max(256), BOOTSTRAP_TOTP_BASE64: z.base64(),
    BOOTSTRAP_EMERGENCY_PHONE: z.string().regex(/^\+[1-9]\d{7,14}$/).optional(),
  }).parse(process.env);
  if (Buffer.from(input.BOOTSTRAP_TOTP_BASE64, 'base64').length < 20) throw new Error('Provision a TOTP secret with at least 20 random bytes.');
  await migrate();
  const agencyId = randomUUID();
  const branchId = randomUUID();
  const credentials = await passwordHash(input.BOOTSTRAP_OWNER_PASSWORD);
  await transaction(async () => {
    await Agency.create({ id: agencyId, name: input.BOOTSTRAP_AGENCY, emergencyContact: input.BOOTSTRAP_EMERGENCY_PHONE });
    await Branch.create({ id: branchId, agencyId, name: input.BOOTSTRAP_BRANCH, code: 'MAIN' });
    const owner = await User.create({ email: input.BOOTSTRAP_OWNER_EMAIL.toLowerCase(), name: input.BOOTSTRAP_OWNER_NAME,
      passwordHash: credentials, mfaSecret: encrypt(input.BOOTSTRAP_TOTP_BASE64) });
    await Membership.create({ agencyId, userId: owner.id, branchIds: [branchId], role: 'OWNER' });
  });
  console.log('Agency ID: ' + agencyId);
}

bootstrap().catch(() => { console.error('Agency bootstrap failed. Check database connectivity, the bootstrap environment and owner email uniqueness.'); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
