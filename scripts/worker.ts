import mongoose from 'mongoose';
import { setTimeout } from 'node:timers/promises';
import { connect, logger } from '../src/server/db';
import { processNotification, processWebhook } from '../src/server/integrations/winquly';

async function run() {
  await connect();
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { stopping = true; });
  while (!stopping) {
    try {
      const sent = await processNotification();
      const received = await processWebhook();
      if (!sent && !received) await setTimeout(1500);
    } catch {
      logger.error('Worker iteration failed');
      await setTimeout(5000);
    }
  }
  await mongoose.disconnect();
}

run().catch(() => { logger.fatal('Worker could not start'); process.exitCode = 1; });
