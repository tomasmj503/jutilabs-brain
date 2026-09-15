import Fastify from 'fastify';
import pino from 'pino';
import { env } from './config/env.js';
import { registrarWebhookChatwoot } from './ingesta/webhook.js';

const log = pino({ level: env.LOG_LEVEL });
const app = Fastify({ logger: false });

app.get('/health', async () => ({ ok: true, servicio: 'jutilabs-brain', env: env.NODE_ENV }));
await registrarWebhookChatwoot(app);

app
  .listen({ port: env.PORT, host: '0.0.0.0' })
  .then(() => log.info({ port: env.PORT }, 'jutilabs-brain arriba'))
  .catch((e) => {
    log.error(e, 'no arrancó');
    process.exit(1);
  });
