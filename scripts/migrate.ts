import mongoose from 'mongoose';
import { logger, migrate } from '../src/server/db';
migrate().then(() => logger.info('Collections and indexes initialized')).catch(() => {
  logger.error('Database initialization failed');
  process.exitCode = 1;
}).finally(() => mongoose.disconnect());
