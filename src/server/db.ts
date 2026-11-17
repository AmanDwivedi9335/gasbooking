import mongoose from 'mongoose';
import pino from 'pino';
import { models } from './models';

export const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
mongoose.set('transactionAsyncLocalStorage', true);

let connected: Promise<typeof mongoose> | undefined;
export async function connect() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required');
  connected ??= mongoose.connect(uri, { serverSelectionTimeoutMS: 5000, maxPoolSize: 20 }).catch(error => {
    connected = undefined;
    throw error;
  });
  return connected;
}

export async function migrate() {
  await connect();
  await Promise.all(models.map(async model => {
    await model.createCollection();
    await model.createIndexes();
  }));
}

export async function transaction<T>(operation: () => Promise<T>) {
  await connect();
  return mongoose.connection.transaction(operation, { readPreference: 'primary', writeConcern: { w: 'majority' } });
}

export class Problem extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export function invariant(value: unknown, status: number, code: string, message: string): asserts value {
  if (!value) throw new Problem(status, code, message);
}

