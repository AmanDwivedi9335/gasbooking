import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { fixture } from './fixture';
import { encrypt } from '../src/server/crypto';
import { User } from '../src/server/models';

async function run() {
  const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  process.env.MONGODB_URI = mongo.getUri();
  process.env.APP_ORIGIN = 'http://localhost:3100';
  process.env.CREDENTIAL_KEY = randomBytes(32).toString('base64');
  try {
    const demo = await fixture('browser-password-2026', true);
    await User.updateOne({ id: demo.admin.userId }, { $set: { mfaSecret: encrypt(Buffer.from('playwright-auth-test').toString('base64')) } });
    await mongoose.disconnect();
    const require = createRequire(import.meta.url);
    const app = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', '3100'], {
      stdio: 'inherit', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
    });
    const stop = () => app.kill();
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
    await new Promise<void>((resolve, reject) => { app.once('exit', () => resolve()); app.once('error', reject); });
  } finally { await mongo.stop(); }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
