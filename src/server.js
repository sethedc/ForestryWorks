import express from 'express';
import { config, validateConfig } from './config.js';
import { logger } from './logger.js';
import { workflow } from './workflow.js';

validateConfig();

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

app.get('/healthz', (_req, res) => res.status(200).json({ status: 'ok' }));

function authorized(req) {
  if (!config.webhookSecret) return true;
  const header = req.get('x-webhook-secret') || '';
  const query = String(req.query.token || '');
  return header === config.webhookSecret || query === config.webhookSecret;
}

app.post('/webhooks/brillium', async (req, res) => {
  if (!authorized(req)) {
    logger.warn('Rejected webhook with bad secret');
    return res.status(401).json({ status: 'unauthorized' });
  }

  try {
    const result = await workflow.run(req.body || {});
    logger.info('Webhook processed', result);
    return res.status(200).json(result);
  } catch (error) {
    const status = error.status === 400 ? 400 : 500;
    logger.error('Webhook processing failed', {
      error: error.message,
      status,
      stack: error.stack
    });
    // 500 tells Brillium (or any retry layer) the attempt is worth retrying; 400 does not.
    return res.status(status).json({ status: 'error', message: error.message });
  }
});

app.use((_req, res) => res.status(404).json({ status: 'not_found' }));

const server = app.listen(config.port, '0.0.0.0', () => {
  logger.info('Listening', { port: config.port });
});

const shutdown = (signal) => {
  logger.info('Shutting down', { signal });
  server.close(() => process.exit(0));
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
