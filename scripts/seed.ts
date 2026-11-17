import mongoose from 'mongoose';
import { verify } from '@node-rs/argon2';
import { passwordHash } from '../src/server/auth';
import { connect, invariant, logger, transaction } from '../src/server/db';
import { demoAccounts, localDemoEnabled } from '../src/server/demo';
import { Membership, Session, User } from '../src/server/models';
import { fixture } from './fixture';

async function seed() {
  if (!localDemoEnabled()) {
    throw new Error('Development seeding requires ALLOW_DEMO_SEED=true and a loopback APP_ORIGIN.');
  }
  await connect();
  const accounts = Object.values(demoAccounts);
  const users = await User.find({ email: { $in: accounts.map(account => account.email) } })
    .select('+passwordHash +mfaSecret').lean();
  if (!users.length) {
    await fixture('admin', true, { demo: true });
    logger.info('Development workspace created');
    return;
  }

  const members = await Membership.find({ userId: { $in: users.map(user => user.id) } }).lean();
  invariant(users.length === accounts.length && members.length === accounts.length && new Set(members.map(member => member.agencyId)).size === 1 &&
    accounts.every(account => members.some(member => member.role === account.role &&
      users.some(user => user.id === member.userId && user.email === account.email))),
  409, 'DEMO_ACCOUNTS_CONFLICT', 'The existing demo addresses do not match one seeded workspace.');

  const upToDate = await Promise.all(users.map(async user => user.demo && !user.mfaSecret && await verify(user.passwordHash, 'admin')));
  if (upToDate.every(Boolean)) {
    logger.info('Development data and credentials already exist');
    return;
  }

  const hash = await passwordHash('admin');
  await transaction(async () => {
    await User.updateMany({ id: { $in: users.map(user => user.id) } }, {
      $set: { passwordHash: hash, demo: true }, $unset: { mfaSecret: 1, lastMfaStep: 1 },
    });
    await Session.deleteMany({ membershipId: { $in: members.map(member => member.id) } });
  });
  logger.info('Updated all three demo sign-ins in the existing database');
}

seed().catch((error: Error) => { logger.error({ message: error.message }, 'Seed failed'); process.exitCode = 1; }).finally(() => mongoose.disconnect());
