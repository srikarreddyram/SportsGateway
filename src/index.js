import { config, publicConfig } from './config.js';
import { logger } from './logger.js';
import { buildGateway } from './container.js';

const { app, shutdown } = buildGateway();

const server = app.listen(config.port, () => {
  logger.info({ port: config.port, config: publicConfig() }, 'sportsgateway listening');
});

// Keep-alive slightly above the load balancer's timeout, so Nginx never reuses a socket
// the gateway is in the middle of closing (a classic source of phantom 502s under load).
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

let shuttingDown = false;

async function stop(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');

  const force = setTimeout(() => {
    logger.error('graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, config.shutdownGraceMs).unref();

  server.close(async () => {
    await shutdown();
    clearTimeout(force);
    logger.info('shutdown complete');
    process.exit(0);
  });
}

process.on('SIGTERM', () => void stop('SIGTERM'));
process.on('SIGINT', () => void stop('SIGINT'));

process.on('unhandledRejection', (reason) => logger.error({ err: reason }, 'unhandled promise rejection'));
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception, exiting');
  process.exit(1);
});
