import Fastify from 'fastify';
import pino from 'pino';
import { env } from './config/env.js';
import { registrarWebhookChatwoot } from './ingesta/webhook.js';
import { redis } from './db/redis.js';
import { apagarOrdenado } from './apagado.js';

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

// Cierre ordenado: docker stop manda SIGTERM. Se termina lo que está en curso antes de salir.
let apagando = false;
for (const senal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(senal, () => {
    if (apagando) {
      console.error(`APAGADO: segunda señal (${senal}), salgo ya`);
      process.exit(1);
    }
    apagando = true;
    void apagarOrdenado({ senal, cerrarServidor: () => app.close(), cerrarRedis: async () => { await redis.quit(); } })
      .then((cortados) => process.exit(cortados > 0 ? 1 : 0));
  });
}
