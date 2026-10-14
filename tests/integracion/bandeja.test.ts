import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { conPg, crearCliente, crearSupabaseDePrueba, limpiarTablas, redisConInterruptor } from './entorno.js';

// INT-BANDEJA (PC-13): Postgres y Redis REALES. El mundo de afuera (Chatwoot, n8n, OpenRouter) se simula.
const { redis, estado } = redisConInterruptor();
const mundo = {
  envios: [] as string[], notas: [] as string[], abiertas: 0, avisos: [] as string[], llm: 0,
  guion: [] as Array<{ texto?: string; error?: boolean }>,
};

vi.mock('../../src/config/env.js', () => ({
  env: { BUFFER_MS: 0, LOCK_TTL_MS: 5000, CHATWOOT_BASE_URL: 'http://chatwoot.test', N8N_WEBHOOK_AVISOS: 'http://n8n.test', N8N_WEBHOOK_SECRET: 's' },
  secretoPorRef: () => 'x',
}));
vi.mock('../../src/db/supabase.js', async () => ({ supabase: (await import('./entorno.js')).crearSupabaseDePrueba() }));
vi.mock('../../src/db/redis.js', () => ({ get redis() { return redis; } }));
vi.mock('../../src/salida/chatwoot.js', () => ({
  enviarMensaje: async (_c: unknown, _n: number, t: string) => { mundo.envios.push(t); return 5000 + mundo.envios.length; },
  enviarNotaPrivada: async (_c: unknown, _n: number, t: string) => { mundo.notas.push(t); },
  marcarAbierta: async () => { mundo.abiertas++; },
  idUsuarioBot: async () => 1,
}));
vi.mock('../../src/salida/avisoEquipo.js', () => ({
  avisarAlCelular: async (_c: unknown, _n: number, t: string) => { mundo.avisos.push(t); },
}));
vi.mock('../../src/llm/conReintento.js', () => ({
  llamarLLMConReintento: async () => {
    mundo.llm++;
    const paso = mundo.guion.shift() ?? { texto: 'Respuesta del modelo.' };
    if (paso.error) throw new Error('el modelo falló');
    return { texto: paso.texto, modelo: 'm', tokensEntrada: 1, tokensSalida: 1, latenciaMs: 1, herramientasUsadas: [], proveedores: [], noSeElDato: false };
  },
}));

const { barrerBandeja, guardarEntranteDurable, ESPERA_MINIMA_MS } = await import('../../src/ingesta/bandeja.js');
const { cargarClientesActivos } = await import('../../src/config/cliente.js');

const supabase = crearSupabaseDePrueba();
const minutos = (n: number) => n * 60_000;

const aviso = (messageId: number, contenido: string, conversationId = 7, accountId = 1) => ({
  evento: 'message_created', direccion: 'entrante', privado: false, messageId, conversationId, accountId,
  contactId: 5, telefono: '573001234567', remitenteTipo: 'contact', remitenteId: 5, contenido, estado: null,
  errorExterno: null, adjuntos: [],
} as never);

async function clienteConfig(slug: string) {
  const todos = await cargarClientesActivos();
  const cfg = todos.find((c) => c.slug === slug);
  if (!cfg) throw new Error(`cliente ${slug} no encontrado`);
  return cfg;
}

/** Envejece los mensajes del huésped (para no esperar minutos reales). */
async function envejecer(minutosAtras: number): Promise<void> {
  await conPg((c) => c.query(`update public.mensajes set created_at = now() - make_interval(mins => $1) where rol = 'huesped'`, [minutosAtras]));
}
const atendidoAt = async (): Promise<Array<string | null>> => {
  const r = await supabase.from('mensajes').select('atendido_at').eq('rol', 'huesped');
  return ((r.data ?? []) as Array<{ atendido_at: string | null }>).map((f) => f.atendido_at);
};
const estadoBot = async (): Promise<string> => {
  const r = await supabase.from('conversaciones').select('estado_bot').limit(1).maybeSingle();
  return (r.data as { estado_bot: string }).estado_bot;
};

beforeEach(async () => {
  await limpiarTablas();
  estado.caido = false;
  mundo.envios.length = 0; mundo.notas.length = 0; mundo.abiertas = 0; mundo.avisos.length = 0; mundo.llm = 0; mundo.guion.length = 0;
  const llaves = await redis.keys('lock:*');
  if (llaves.length) await redis.del(...llaves);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterAll(() => redis.quit());

describe('bandeja durable', () => {
  it('guardar antes del 200 deja el mensaje sin atender y es idempotente', async () => {
    await crearCliente('a', 1);
    const cfg = await clienteConfig('a');
    await guardarEntranteDurable(cfg, aviso(501, 'ya pagué'));
    await guardarEntranteDurable(cfg, aviso(501, 'ya pagué'));
    const r = await supabase.from('mensajes').select('contenido, atendido_at, rol').eq('cliente_id', cfg.id);
    expect(r.data).toHaveLength(1);
    expect(r.data?.[0]).toMatchObject({ contenido: 'ya pagué', atendido_at: null, rol: 'huesped' });
  });

  it('con el proceso caído a mitad (mensaje guardado, nadie lo atendió) el barrido rehace el turno y lo marca atendido', async () => {
    await crearCliente('a', 1);
    const cfg = await clienteConfig('a');
    await guardarEntranteDurable(cfg, aviso(501, '¿tienen cupo mañana?'));
    await envejecer(4);
    const r = await barrerBandeja();
    expect(r).toMatchObject({ revisadas: 1, reintentadas: 1 });
    expect(mundo.llm).toBe(1);
    expect(mundo.envios).toEqual(['Respuesta del modelo.']);
    expect((await atendidoAt()).every((x) => x !== null)).toBe(true);
    // Y un segundo barrido ya no encuentra nada.
    expect((await barrerBandeja()).revisadas).toBe(0);
  });

  it('el historial del modelo no repite el mensaje que se está atendiendo', async () => {
    await crearCliente('a', 1);
    const cfg = await clienteConfig('a');
    const { obtenerContexto } = await import('../../src/conversacion/almacen.js');
    await guardarEntranteDurable(cfg, aviso(501, 'primero'));
    await guardarEntranteDurable(cfg, aviso(502, 'segundo'));
    const ctx = await obtenerContexto(cfg, { conversationId: 7, contactId: 5, telefono: null, canal: 'whatsapp' }, [502]);
    expect(ctx.ultimosMensajes.map((m) => m.contenido)).toEqual(['primero']);
  });

  it('antes de los 3 minutos no toca nada', async () => {
    await crearCliente('a', 1);
    await guardarEntranteDurable(await clienteConfig('a'), aviso(501, 'hola'));
    await envejecer(1);
    expect((await barrerBandeja()).revisadas).toBe(0);
    expect(mundo.llm).toBe(0);
    expect(ESPERA_MINIMA_MS).toBe(minutos(3));
  });

  it('si ya hay una respuesta posterior (bot o persona) solo lo marca: NUNCA responde dos veces', async () => {
    const id = await crearCliente('a', 1);
    const cfg = await clienteConfig('a');
    await guardarEntranteDurable(cfg, aviso(501, 'hola'));
    await envejecer(5);
    const conv = await supabase.from('conversaciones').select('id').eq('cliente_id', id).maybeSingle();
    await supabase.from('mensajes').insert({
      cliente_id: id, conversacion_id: (conv.data as { id: string }).id, chatwoot_message_id: 900, rol: 'bot', contenido: 'ya respondí',
    });
    const r = await barrerBandeja();
    expect(r).toMatchObject({ yaContestadas: 1, reintentadas: 0 });
    expect(mundo.llm).toBe(0);
    expect(mundo.envios).toEqual([]);
    expect((await atendidoAt()).every((x) => x !== null)).toBe(true);
  });

  it('con más de 15 minutos sin atender no rehace el turno: nota + aviso al equipo, sin pausar ni escribirle al huésped', async () => {
    await crearCliente('a', 1);
    await guardarEntranteDurable(await clienteConfig('a'), aviso(501, 'ya pagué, ¿me confirman?'));
    await envejecer(20);
    const r = await barrerBandeja();
    expect(r).toMatchObject({ escaladas: 1, reintentadas: 0 });
    expect(mundo.llm).toBe(0);
    expect(mundo.envios).toEqual([]);
    expect(mundo.notas).toHaveLength(1);
    expect(mundo.notas[0]).toContain('ya pagué');
    expect(mundo.avisos).toHaveLength(1);
    expect(mundo.abiertas).toBe(1);
    expect(await estadoBot()).toBe('activo');
    expect((await atendidoAt()).every((x) => x !== null)).toBe(true);
  });

  it('Redis detenido: no se puede tomar el candado → el barrido escala con nota y aviso (no calla)', async () => {
    await crearCliente('a', 1);
    await guardarEntranteDurable(await clienteConfig('a'), aviso(501, 'hola?'));
    await envejecer(5);
    estado.caido = true;
    const r = await barrerBandeja();
    expect(r.escaladas).toBe(1);
    expect(mundo.notas).toHaveLength(1);
    expect(mundo.avisos).toHaveLength(1);
    expect(mundo.llm).toBe(0);
  });

  it('candado agotado (otro turno la tiene): no la toca y queda pendiente para el próximo barrido', async () => {
    const id = await crearCliente('a', 1);
    await guardarEntranteDurable(await clienteConfig('a'), aviso(501, 'hola'));
    await envejecer(5);
    await redis.set(`lock:${id}:7`, 'otro-turno', 'PX', 60_000);
    const r = await barrerBandeja();
    expect(r).toMatchObject({ ocupadas: 1, reintentadas: 0 });
    expect(mundo.llm).toBe(0);
    expect((await atendidoAt()).every((x) => x === null)).toBe(true);
  });

  it('si el turno revienta, la recuperación escala y el mensaje queda atendido', async () => {
    await crearCliente('a', 1);
    await guardarEntranteDurable(await clienteConfig('a'), aviso(501, 'hola'));
    await envejecer(5);
    mundo.guion.push({ error: true }, { error: true });
    await barrerBandeja();
    expect(mundo.notas.length).toBeGreaterThan(0);
    expect((await atendidoAt()).every((x) => x !== null)).toBe(true);
  });

  it('bot apagado (bot_activo=false): el barrido no le contesta al huésped', async () => {
    await crearCliente('a', 1, { bot_activo: false });
    await guardarEntranteDurable(await clienteConfig('a'), aviso(501, 'hola'));
    await envejecer(5);
    expect((await barrerBandeja()).revisadas).toBe(0);
    expect(mundo.envios).toEqual([]);
  });

  it('aislamiento: cada cliente atiende lo suyo', async () => {
    await crearCliente('a', 1);
    await crearCliente('b', 2);
    await guardarEntranteDurable(await clienteConfig('a'), aviso(501, 'hola de A', 7, 1));
    await guardarEntranteDurable(await clienteConfig('b'), aviso(501, 'hola de B', 7, 2)); // mismo id de mensaje y conversación
    await envejecer(5);
    const r = await barrerBandeja();
    expect(r.reintentadas).toBe(2);
    expect(mundo.envios).toHaveLength(2);
    expect((await atendidoAt()).every((x) => x !== null)).toBe(true);
  });
});
