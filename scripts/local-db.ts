import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

async function run() {
  const dbPath = resolve('.local/mongodb');
  await mkdir(dbPath, { recursive: true });
  const mongo = await MongoMemoryReplSet.create({
    instanceOpts: [{ port: 27028, dbPath }],
    replSet: { count: 1, name: 'rs0', storageEngine: 'wiredTiger', ip: '127.0.0.1' },
  });
  console.log('Local MongoDB is ready at ' + mongo.getUri('cylinder_ops'));
  await new Promise<void>(resolve => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
  });
  await mongo.stop({ doCleanup: false });
}

run().catch(error => { console.error(error); process.exitCode = 1; });
