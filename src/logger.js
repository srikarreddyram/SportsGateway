import pino from 'pino';
import { config } from './config.js';

export const logger = pino({
  level: config.logLevel,
  base: { service: 'sportsgateway', instance: config.instanceId },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label }),
  },
  // Local development only: pino-pretty is a devDependency, so the production image
  // (built with --omit=dev) must leave LOG_PRETTY unset and emit JSON.
  ...(config.logPretty
    ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss.l' } } }
    : {}),
});

export const createLogger = (component) => logger.child({ component });
