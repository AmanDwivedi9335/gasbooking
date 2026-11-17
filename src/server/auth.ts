import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { cookies } from 'next/headers';
import { Agency, Branch, Membership, RateLimit, Session, User } from './models';
import { connect, invariant } from './db';
import { roles, type Actor, type Role } from './policy';
import { decrypt } from './crypto';
import { demoAccounts, localDemoEnabled, type LoginWorkspace } from './demo';

const SESSION_COOKIE = 'cylinder_session';
const SESSION_AGE = 12 * 3600;
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const passwordHash = (value: string) => hash(value, { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 });
const fallbackHash = passwordHash(randomBytes(32).toString('hex'));

export async function limit(key: string, max: number, interval: number) {
  const bucket = Math.floor(Date.now() / interval);
  const windowKey = digest(key + ':' + bucket);
  const update = { $setOnInsert: { key: windowKey, expiresAt: new Date((bucket + 2) * interval) }, $inc: { attempts: 1 } };
  const counter = await RateLimit.findOneAndUpdate({ key: windowKey }, update, { upsert: true, returnDocument: 'after', setDefaultsOnInsert: false }).catch(async error => {
    if (error.code !== 11000) throw error;
    return RateLimit.findOneAndUpdate({ key: windowKey }, { $inc: { attempts: 1 } }, { returnDocument: 'after' });
  });
  invariant(counter && counter.attempts <= max, 429, 'RATE_LIMIT', 'Too many requests. Try again later.');
}

export function totp(secret: Buffer, step: number) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const result = createHmac('sha1', secret).update(counter).digest();
  const offset = result[result.length - 1] & 15;
  return String((result.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

async function actorFor(membershipId: string): Promise<Actor | null> {
  const member = await Membership.findOne({ id: membershipId, active: true }).lean();
  if (!member || !Object.hasOwn(roles, member.role) || (member.role === 'CUSTOMER' && !member.customerId)) return null;
  const user = await User.findOne({ id: member.userId, active: true }).lean();
  if (!user || (user.demo && !localDemoEnabled())) return null;
  return { userId: user.id, name: user.name, membershipId, agencyId: member.agencyId, role: member.role as Role,
    branchIds: member.branchIds, customerId: member.customerId ?? undefined };
}

export async function signIn(input: { identifier: string; password: string; agency?: string; otp?: string; workspace?: LoginWorkspace }) {
  await connect();
  const demo = localDemoEnabled();
  const account = input.identifier === 'admin' && demo ? demoAccounts[input.workspace ?? 'app'] : undefined;
  const email = account?.email ?? input.identifier;
  await limit('login:' + email, 8, 15 * 60_000);
  const user = await User.findOne({ email, active: true, ...(account ? { demo: true } : demo ? {} : { demo: { $ne: true } }) })
    .select('+passwordHash +mfaSecret');
  const correct = await verify(user?.passwordHash ?? await fallbackHash, input.password);
  invariant(user && correct, 401, 'LOGIN_FAILED', 'The user ID or password is incorrect.');
  const members = await Membership.find({ userId: user.id, active: true, ...(input.agency ? { agencyId: input.agency } : {}) }).limit(2).lean();
  invariant(members.length === 1, 400, 'AGENCY_REQUIRED', 'Enter the agency ID assigned to your account.');
  const actor = await actorFor(members[0].id);
  invariant(actor && (!account || actor.role === account.role), 401, 'LOGIN_FAILED', 'This account is unavailable.');
  const privileged = ['OWNER', 'BRANCH_MANAGER', 'ACCOUNTS', 'INVENTORY', 'SUPERVISOR'].includes(actor.role);
  if (user.mfaSecret || (privileged && !user.demo)) {
    invariant(user.mfaSecret && input.otp, 401, 'MFA_REQUIRED', 'Enter your authenticator code. Contact your administrator if MFA has not been provisioned.');
    const step = Math.floor(Date.now() / 30_000);
    const secret = Buffer.from(decrypt(user.mfaSecret), 'base64');
    const accepted = [step, step - 1, step + 1].find(value =>
      timingSafeEqual(Buffer.from(totp(secret, value)), Buffer.from(input.otp!)));
    invariant(accepted !== undefined, 401, 'MFA_FAILED', 'The authenticator code is invalid.');
    const used = await User.updateOne({ id: user.id, $or: [{ lastMfaStep: { $exists: false } }, { lastMfaStep: { $lt: accepted } }] }, { $set: { lastMfaStep: accepted } });
    invariant(used.modifiedCount, 401, 'MFA_REUSED', 'Wait for a new authenticator code.');
  }
  const token = randomBytes(32).toString('base64url');
  await Session.create({ tokenHash: digest(token), membershipId: actor.membershipId, expiresAt: new Date(Date.now() + SESSION_AGE * 1000) });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: 'lax', path: '/', maxAge: SESSION_AGE,
    secure: process.env.NODE_ENV === 'production',
  });
  return actor;
}

export async function currentActor() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  await connect();
  const session = await Session.findOne({ tokenHash: digest(token), expiresAt: { $gt: new Date() } }).lean();
  return session ? actorFor(session.membershipId) : null;
}

export async function signOut() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await connect();
    await Session.deleteOne({ tokenHash: digest(token) });
  }
  jar.delete(SESSION_COOKIE);
}

export async function workspace(actor: Actor) {
  const [agency, branches] = await Promise.all([
    Agency.findOne({ id: actor.agencyId }).lean(),
    Branch.find({ agencyId: actor.agencyId, id: { $in: actor.branchIds } }).sort({ name: 1 }).lean(),
  ]);
  return { agency: agency?.name ?? 'Agency workspace', emergencyContact: agency?.emergencyContact ?? undefined,
    branches: branches.map(branch => ({ id: branch.id, name: branch.name, code: branch.code, deliveryOtp: Boolean(branch.deliveryOtp) })) };
}
