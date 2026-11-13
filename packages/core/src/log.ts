import pino from 'pino';
import { env } from './env.ts';

export const logger = pino({
  level: env.logLevel,
  transport: process.stdout.isTTY ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } : undefined,
});
export const childLogger = (bindings: Record<string, unknown>) => logger.child(bindings);
