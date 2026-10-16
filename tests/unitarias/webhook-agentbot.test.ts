import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { createHmac } from 'node:crypto';

// Agent Bot de Chatwoot 4.17.0: firma X-Chatwoot-Signature = "sha256=" + HMAC-SHA256(secreto_bot, `${ts}.${cuerpo crudo}`),
// y el bot solo atiende conversaciones en "pending".
const SECRETO_BOT_A = 'secreto-del-agent-bot-a';
const SECRETO_BOT_B = 'secreto-del-agent-bot-b';
const SECRETO_VIEJO_A = 'secreto-viejo-del-cliente-a-0123456789-abcdefghij';
const SECRETOS: Record<string, string> = { BOT_A: SECRETO_BOT_A, BOT_B: SECRETO_BOT_B, WEBHOOK_A: SECRETO_VIEJO_A };

vi.mock('../../src/config/env.js', () => ({
  env: { CHATWOOT_WEBHOOK_SECRET: 'global-vieja' },
  secretoPorRef: (ref: string) => {
    const v = SECRETOS[ref];
    if (!v) throw new Error(`Secreto no configurado: ${ref}`);
    return v;
  },
}));
let botActivoA = true;
let modoAgenteA = true; // con chatwootBotTokenRef = modo Agent Bot (regla "pending"); sin él, comportamiento anterior
const cfgA = () => ({
  id: 'ca', slug: 'a', activo: true, botActivo: botActivoA, chatwootAccountId: 1, chatwootWebhookSecretRef: 'WEBHOOK_A',
  chatwootBotSecretRef: 'BOT_A', chatwootBotTokenRef: modoAgenteA ? 'TOKEN_A' : null,
});
const cfgB = () => ({ id: 'cb', slug: 'b', activo: true, botActivo: true, chatwootAccountId: 2, chatwootWebhookSecretRef: null, chatwootBotSecretRef: 'BOT_B' });
vi.mock('../../src/config/cliente.js', () => ({
  cargarClientePorSlug: async (slug: string) => (slug === 'a' ? cfgA() : slug === 'b' ? cfgB() : null),
  cargarClientePorChatwootAccount: async (id: number) => (id === 1 ? cfgA() : id === 2 ? cfgB() : null),
}));
const entrante = vi.fn();
const saliente = vi.fn();
const guardar = vi.fn();
const apagado = vi.fn();
vi.mock('../../src/ingesta/procesarEntrante.js', () => ({ procesarEntrante: entrante }));
vi.mock('../../src/ingesta/procesarSaliente.js', () => ({ procesarSaliente: saliente }));
vi.mock('../../src/ingesta/bandeja.js', () => ({ esEntranteGuardable: () => true, guardarEntranteDurable: guardar, recibirConBotApagado: apagado }));
vi.mock('../../src/ingesta/liberacion.js', () => ({ esComandoLiberar: () => false, procesarLiberacion: vi.fn() }));
vi.mock('../../src/ingesta/revisarFallo.js', () => ({ procesarActualizacion: vi.fn() }));

const { registrarWebhookChatwoot, verificarFirma, TOLERANCIA_FIRMA_MS } = await import('../../src/ingesta/webhook.js');
const { esperarEnCurso } = await import('../../src/ingesta/enCurso.js');

const cuerpo = (accountId: number, estado: string | null = 'pending', extra: object = {}) => ({
  event: 'message_created', message_type: 'incoming', id: 9, content: 'hola', account: { id: accountId },
  conversation: { id: 7, ...(estado === null ? {} : { status: estado }) }, sender: { type: 'contact', id: 5 }, ...extra,
});

const firmar = (secreto: string, ts: string, crudo: string) => 'sha256=' + createHmac('sha256', secreto).update(`${ts}.${crudo}`).digest('hex');
const ahoraSeg = () => String(Math.floor(Date.now() / 1000));

interface Opciones { ts?: string; firma?: string; secreto?: string; crudo?: string; extra?: Record<string, string> }

/** Envía el aviso como lo hace el Agent Bot: cuerpo crudo exacto + firma sobre esos mismos bytes. */
async function enviarFirmado(url: string, objeto: unknown, o: Opciones = {}) {
  const crudo = o.crudo ?? JSON.stringify(objeto);
  const ts = o.ts ?? ahoraSeg();
  const app = Fastify();
  await registrarWebhookChatwoot(app);
  const r = await app.inject({
    method: 'POST', url, payload: crudo,
    headers: {
      'content-type': 'application/json', 'x-chatwoot-timestamp': ts, 'x-chatwoot-delivery': 'entrega-1',
      'x-chatwoot-signature': o.firma ?? firmar(o.secreto ?? SECRETO_BOT_A, ts, crudo), ...o.extra,
    },
  });
  await esperarEnCurso(2_000);
  await app.close();
  return r.statusCode;
}

beforeEach(() => {
  vi.clearAllMocks();
  botActivoA = true;
  modoAgenteA = true;
  guardar.mockResolvedValue(undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('verificarFirma', () => {
  const crudo = Buffer.from('{"a":1}');
  const ahora = 1_800_000_000_000;
  const ts = String(ahora / 1000);
  const buena = firmar('s', ts, '{"a":1}');

  it('firma correcta → ok', () => expect(verificarFirma('s', ts, buena, crudo, ahora)).toBe('ok'));
  it('sin encabezados → sin-firma', () => {
    expect(verificarFirma('s', undefined, buena, crudo, ahora)).toBe('sin-firma');
    expect(verificarFirma('s', ts, undefined, crudo, ahora)).toBe('sin-firma');
  });
  it('secreto distinto, cuerpo alterado o sin el prefijo sha256= → firma-invalida', () => {
    expect(verificarFirma('otro', ts, buena, crudo, ahora)).toBe('firma-invalida');
    expect(verificarFirma('s', ts, buena, Buffer.from('{"a":2}'), ahora)).toBe('firma-invalida');
    expect(verificarFirma('s', ts, buena.slice('sha256='.length), crudo, ahora)).toBe('firma-invalida');
    expect(verificarFirma('s', ts, 'sha256=corta', crudo, ahora)).toBe('firma-invalida');
  });
  it('el timestamp forma parte de lo firmado: cambiarlo invalida la firma', () => {
    expect(verificarFirma('s', String(Number(ts) + 1), buena, crudo, ahora)).toBe('firma-invalida');
  });
  it('timestamp a más de 5 min (pasado o futuro) → timestamp-viejo, aunque la firma sea auténtica', () => {
    const viejo = String(Number(ts) - TOLERANCIA_FIRMA_MS / 1000 - 1);
    expect(verificarFirma('s', viejo, firmar('s', viejo, '{"a":1}'), crudo, ahora)).toBe('timestamp-viejo');
    const futuro = String(Number(ts) + TOLERANCIA_FIRMA_MS / 1000 + 1);
    expect(verificarFirma('s', futuro, firmar('s', futuro, '{"a":1}'), crudo, ahora)).toBe('timestamp-viejo');
  });
  it('justo dentro de los 5 min → ok', () => {
    const limite = String(Number(ts) - TOLERANCIA_FIRMA_MS / 1000 + 1);
    expect(verificarFirma('s', limite, firmar('s', limite, '{"a":1}'), crudo, ahora)).toBe('ok');
  });
  it('timestamp que no es un número → timestamp-invalido', () => {
    expect(verificarFirma('s', 'ayer', buena, crudo, ahora)).toBe('timestamp-invalido');
    expect(verificarFirma('s', '-5', buena, crudo, ahora)).toBe('timestamp-invalido');
  });
});

describe('POST /webhook/chatwoot/:slug con firma del Agent Bot', () => {
  it('firma válida (sin ?secret) → 200 y se procesa', async () => {
    expect(await enviarFirmado('/webhook/chatwoot/a', cuerpo(1))).toBe(200);
    expect(entrante).toHaveBeenCalledTimes(1);
  });

  it('la firma se calcula sobre el cuerpo CRUDO: espacios y orden de claves distintos del JSON re-serializado siguen siendo válidos', async () => {
    const crudo = '{ "conversation" : {"status":"pending", "id": 7},\n  "id": 9, "content":"hola",\t"event":"message_created",'
      + ' "message_type":"incoming", "account":{"id":1}, "sender":{"type":"contact","id":5} }';
    expect(await enviarFirmado('/webhook/chatwoot/a', null, { crudo })).toBe(200);
    expect(entrante).toHaveBeenCalledTimes(1);
  });

  it('firma inválida (un byte distinto) → 401 y no se procesa nada', async () => {
    const crudo = JSON.stringify(cuerpo(1));
    const ts = ahoraSeg();
    const mala = firmar(SECRETO_BOT_A, ts, crudo).replace(/.$/, (c) => (c === '0' ? '1' : '0'));
    expect(await enviarFirmado('/webhook/chatwoot/a', null, { crudo, ts, firma: mala })).toBe(401);
    expect(entrante).not.toHaveBeenCalled();
    expect(guardar).not.toHaveBeenCalled();
  });

  it('cuerpo alterado después de firmar → 401', async () => {
    const original = JSON.stringify(cuerpo(1));
    const ts = ahoraSeg();
    const firma = firmar(SECRETO_BOT_A, ts, original);
    expect(await enviarFirmado('/webhook/chatwoot/a', null, { crudo: original.replace('hola', 'adiós'), ts, firma })).toBe(401);
    expect(entrante).not.toHaveBeenCalled();
  });

  it('firma vieja (timestamp de hace 10 min, firma auténtica) → 401: repetición', async () => {
    const ts = String(Math.floor(Date.now() / 1000) - 600);
    expect(await enviarFirmado('/webhook/chatwoot/a', cuerpo(1), { ts })).toBe(401);
    expect(entrante).not.toHaveBeenCalled();
  });

  it('firmada con el secreto de OTRO cliente → 401', async () => {
    expect(await enviarFirmado('/webhook/chatwoot/a', cuerpo(1), { secreto: SECRETO_BOT_B })).toBe(401);
    expect(entrante).not.toHaveBeenCalled();
  });

  it('firma válida pero con el account_id de otro cliente en el cuerpo → 401', async () => {
    expect(await enviarFirmado('/webhook/chatwoot/a', cuerpo(2))).toBe(401);
    expect(entrante).not.toHaveBeenCalled();
  });

  it('cliente desconocido → 401', async () => {
    expect(await enviarFirmado('/webhook/chatwoot/nadie', cuerpo(1))).toBe(401);
  });

  it('cliente B, que solo tiene secreto del bot (sin secreto viejo): la firma basta', async () => {
    expect(await enviarFirmado('/webhook/chatwoot/b', cuerpo(2), { secreto: SECRETO_BOT_B })).toBe(200);
    expect(entrante).toHaveBeenCalledTimes(1);
  });

  it('cliente B con firma mala: no hay secreto viejo al que recurrir → 401', async () => {
    expect(await enviarFirmado('/webhook/chatwoot/b?secret=cualquiera', cuerpo(2), { secreto: 'incorrecto' })).toBe(401);
  });

  it('el rechazo no filtra nada: sin autenticar siempre 401, aunque el cuerpo esté vacío o no sea JSON', async () => {
    expect(await enviarFirmado('/webhook/chatwoot/a', null, { crudo: '', firma: 'sha256=00' })).toBe(401);
    expect(await enviarFirmado('/webhook/chatwoot/a', null, { crudo: 'no es json', firma: 'sha256=00' })).toBe(401);
  });

  it('firma válida pero cuerpo que no es JSON → 400 (ya autenticado), sin procesar', async () => {
    expect(await enviarFirmado('/webhook/chatwoot/a', null, { crudo: 'esto no es json' })).toBe(400);
    expect(entrante).not.toHaveBeenCalled();
  });
});

describe('transición: el secreto viejo sigue valiendo en /webhook/chatwoot/:slug', () => {
  it('sin firma, con ?secret= del cliente → 200', async () => {
    const app = Fastify();
    await registrarWebhookChatwoot(app);
    const r = await app.inject({ method: 'POST', url: `/webhook/chatwoot/a?secret=${SECRETO_VIEJO_A}`, payload: cuerpo(1) });
    await esperarEnCurso(2_000);
    await app.close();
    expect(r.statusCode).toBe(200);
    expect(entrante).toHaveBeenCalledTimes(1);
  });

  it('firma mala + secreto viejo bueno → 200 (cada mecanismo es prueba suficiente por sí solo)', async () => {
    expect(await enviarFirmado(`/webhook/chatwoot/a?secret=${SECRETO_VIEJO_A}`, cuerpo(1), { secreto: 'incorrecto' })).toBe(200);
    expect(entrante).toHaveBeenCalledTimes(1);
  });

  it('firma mala + secreto viejo malo → 401', async () => {
    expect(await enviarFirmado('/webhook/chatwoot/a?secret=malo', cuerpo(1), { secreto: 'incorrecto' })).toBe(401);
    expect(entrante).not.toHaveBeenCalled();
  });

  it('la ruta vieja /webhook/chatwoot no necesita cuerpo crudo ni firma y sigue igual', async () => {
    const app = Fastify();
    await registrarWebhookChatwoot(app);
    const r = await app.inject({ method: 'POST', url: '/webhook/chatwoot?secret=global-vieja', payload: cuerpo(1) });
    await esperarEnCurso(2_000);
    await app.close();
    expect(r.statusCode).toBe(200);
    expect(entrante).toHaveBeenCalledTimes(1);
  });
});

describe('modo Agent Bot (chatwootBotTokenRef): solo se atiende al huésped si la conversación está en "pending"', () => {
  it('pending → el bot atiende', async () => {
    expect(await enviarFirmado('/webhook/chatwoot/a', cuerpo(1, 'pending'))).toBe(200);
    expect(entrante).toHaveBeenCalledTimes(1);
  });

  it('open → se guarda ya atendido (el barrido no se lo contesta después) y NO se responde', async () => {
    expect(await enviarFirmado('/webhook/chatwoot/a', cuerpo(1, 'open'))).toBe(200);
    expect(entrante).not.toHaveBeenCalled();
    expect(apagado).not.toHaveBeenCalled();
    expect(guardar).toHaveBeenCalled();
    // Guardado previo al 200 y camino asíncrono: los dos con atendido = true.
    for (const llamada of guardar.mock.calls) expect(llamada[2]).toBe(true);
  });

  it.each(['resolved', 'snoozed'])('%s → tampoco se responde', async (estado) => {
    expect(await enviarFirmado('/webhook/chatwoot/a', cuerpo(1, estado))).toBe(200);
    expect(entrante).not.toHaveBeenCalled();
    for (const llamada of guardar.mock.calls) expect(llamada[2]).toBe(true);
  });

  it('aviso sin conversation.status → no se arriesga a hablar encima de una persona: no responde', async () => {
    expect(await enviarFirmado('/webhook/chatwoot/a', cuerpo(1, null))).toBe(200);
    expect(entrante).not.toHaveBeenCalled();
  });

  it('pending → el guardado previo al 200 nace SIN atender (el bot sí lo va a contestar)', async () => {
    await enviarFirmado('/webhook/chatwoot/a', cuerpo(1, 'pending'));
    expect(guardar.mock.calls[0]?.[2]).toBe(false);
  });

  it('si guardar falla en el caso "open", igual responde 200 y no contesta', async () => {
    guardar.mockRejectedValue(new Error('Supabase caído'));
    expect(await enviarFirmado('/webhook/chatwoot/a', cuerpo(1, 'open'))).toBe(200);
    expect(entrante).not.toHaveBeenCalled();
  });

  it('bot apagado + pending → sigue el camino del kill-switch (guarda y abre), no el del modelo', async () => {
    botActivoA = false;
    expect(await enviarFirmado('/webhook/chatwoot/a', cuerpo(1, 'pending'))).toBe(200);
    expect(apagado).toHaveBeenCalledTimes(1);
    expect(entrante).not.toHaveBeenCalled();
  });

  it('la misma regla vale en la ruta vieja: open no se responde', async () => {
    const app = Fastify();
    await registrarWebhookChatwoot(app);
    const r = await app.inject({ method: 'POST', url: '/webhook/chatwoot?secret=global-vieja', payload: cuerpo(1, 'open') });
    await esperarEnCurso(2_000);
    await app.close();
    expect(r.statusCode).toBe(200);
    expect(entrante).not.toHaveBeenCalled();
  });

  it('un mensaje saliente de una persona llega a procesarSaliente aunque la conversación esté en "pending"', async () => {
    const saliente_ = { ...cuerpo(1, 'pending'), message_type: 'outgoing', sender: { type: 'user', id: 42 } };
    expect(await enviarFirmado('/webhook/chatwoot/a', saliente_)).toBe(200);
    expect(saliente).toHaveBeenCalledTimes(1);
    expect(entrante).not.toHaveBeenCalled();
  });
});

describe('modo anterior (sin chatwootBotTokenRef): sin regla "pending", como en 9334409', () => {
  beforeEach(() => { modoAgenteA = false; });

  it.each(['pending', 'open', 'resolved', 'snoozed'])('conversación en "%s" → el bot atiende', async (estado) => {
    expect(await enviarFirmado('/webhook/chatwoot/a', cuerpo(1, estado))).toBe(200);
    expect(entrante).toHaveBeenCalledTimes(1);
  });

  it('aviso sin conversation.status → el bot atiende', async () => {
    expect(await enviarFirmado('/webhook/chatwoot/a', cuerpo(1, null))).toBe(200);
    expect(entrante).toHaveBeenCalledTimes(1);
  });

  it('el guardado previo al 200 nace SIN atender, sea cual sea el estado (solo el bot apagado lo marca atendido)', async () => {
    await enviarFirmado('/webhook/chatwoot/a', cuerpo(1, 'open'));
    expect(guardar.mock.calls[0]?.[2]).toBe(false);
  });

  it('la ruta vieja /webhook/chatwoot tampoco aplica la regla', async () => {
    const app = Fastify();
    await registrarWebhookChatwoot(app);
    const r = await app.inject({ method: 'POST', url: '/webhook/chatwoot?secret=global-vieja', payload: cuerpo(1, 'open') });
    await esperarEnCurso(2_000);
    await app.close();
    expect(r.statusCode).toBe(200);
    expect(entrante).toHaveBeenCalledTimes(1);
  });

  it('bot apagado sigue por el camino del kill-switch', async () => {
    botActivoA = false;
    await enviarFirmado('/webhook/chatwoot/a', cuerpo(1, 'open'));
    expect(apagado).toHaveBeenCalledTimes(1);
    expect(entrante).not.toHaveBeenCalled();
  });
});
