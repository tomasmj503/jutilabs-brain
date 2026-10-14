import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { conPg, crearCliente, crearSupabaseDePrueba, limpiarTablas, redisConInterruptor } from './entorno.js';

// INT-BANDEJA (PC-13): Postgres y Redis REALES. El mundo de afuera (Chatwoot, n8n, OpenRouter) se simula.
const { redis, estado } = redisConInterruptor();
const mundo = {
  envios: [] as string[], notas: [] as string[], abiertas: 0, avisos: [] as string[], llm: 0,
  guion: [] as Array<{ texto?: string; error?: boolean }>,
  /** Resultado del aviso al celular (n8n): 'enviado' | 'fallido' | 'sin_canal'. */
  celular: 'enviado' as 'enviado' | 'fallido' | 'sin_canal',
  /** Si es true, crear una nota privada en Chatwoot falla. */
  notaFalla: false,
};

vi.mock('../../src/config/env.js', () => ({
  env: { BUFFER_MS: 0, LOCK_TTL_MS: 5000, CHATWOOT_BASE_URL: 'http://chatwoot.test', N8N_WEBHOOK_AVISOS: 'http://n8n.test', N8N_WEBHOOK_SECRET: 's' },
  secretoPorRef: () => 'x',
}));
vi.mock('../../src/db/supabase.js', async () => ({ supabase: (await import('./entorno.js')).crearSupabaseDePrueba() }));
vi.mock('../../src/db/redis.js', () => ({ get redis() { return redis; } }));
vi.mock('../../src/salida/chatwoot.js', () => ({
  enviarMensaje: async (_c: unknown, _n: number, t: string) => { mundo.envios.push(t); return 5000 + mundo.envios.length; },
  enviarNotaPrivada: async (_c: unknown, _n: number, t: string) => {
    if (mundo.notaFalla) throw new Error('Chatwoot 500');
    mundo.notas.push(t);
  },
  marcarAbierta: async () => { mundo.abiertas++; },
  idUsuarioBot: async () => 1,
}));
vi.mock('../../src/salida/avisoEquipo.js', () => ({
  avisarAlCelular: async (_c: unknown, _n: number, t: string) => {
    mundo.avisos.push(t);
    return mundo.celular;
  },
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
  mundo.celular = 'enviado'; mundo.notaFalla = false;
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

// INT-ALERTAS (PC-15): nunca decir «ya avisé» si no salió; el barrido reintenta el AVISO y completa la escalación.
describe('avisos al equipo pendientes', () => {
  const pendiente = async () => {
    const r = await supabase.from('conversaciones').select('aviso_pendiente, aviso_pendiente_at, estado_bot').limit(1).maybeSingle();
    return r.data as { aviso_pendiente: { pausar: boolean; textoHuesped: string | null } | null; aviso_pendiente_at: string | null; estado_bot: string };
  };

  it('el huésped pide una persona y n8n está caído: NO se le escribe «ya compartí…», NO se pausa, queda pendiente y el mensaje sin atender', async () => {
    await crearCliente('a', 1);
    const cfg = await clienteConfig('a');
    const { atenderYMarcar } = await import('../../src/ingesta/procesarEntrante.js');
    mundo.celular = 'fallido';
    await guardarEntranteDurable(cfg, aviso(501, 'quiero hablar con una persona'));
    await atenderYMarcar(cfg, {
      clienteId: cfg.id, chatwootConversationId: 7, textoAgrupado: 'quiero hablar con una persona',
      mensajes: [{ clienteId: cfg.id, chatwootAccountId: 1, chatwootConversationId: 7, chatwootContactId: 5, chatwootMessageId: 501, canal: 'whatsapp', telefono: '573001234567', contenido: 'quiero hablar con una persona', tipo: 'texto', recibidoAt: new Date().toISOString() }],
    });
    expect(mundo.envios).toEqual([]);
    const p = await pendiente();
    expect(p.estado_bot).toBe('activo');
    expect(p.aviso_pendiente).toMatchObject({ pausar: true });
    expect(p.aviso_pendiente?.textoHuesped).toBeTruthy();
    expect(p.aviso_pendiente_at).not.toBeNull();
    expect((await atendidoAt()).every((x) => x === null)).toBe(true);
  });

  it('cuando n8n vuelve, el barrido confirma el aviso y COMPLETA: pausa, texto al huésped y mensaje atendido', async () => {
    await crearCliente('a', 1);
    const cfg = await clienteConfig('a');
    const { atenderYMarcar } = await import('../../src/ingesta/procesarEntrante.js');
    mundo.celular = 'fallido';
    await guardarEntranteDurable(cfg, aviso(501, 'quiero hablar con una persona'));
    await atenderYMarcar(cfg, {
      clienteId: cfg.id, chatwootConversationId: 7, textoAgrupado: 'quiero hablar con una persona',
      mensajes: [{ clienteId: cfg.id, chatwootAccountId: 1, chatwootConversationId: 7, chatwootContactId: 5, chatwootMessageId: 501, canal: 'whatsapp', telefono: '573001234567', contenido: 'quiero hablar con una persona', tipo: 'texto', recibidoAt: new Date().toISOString() }],
    });
    // Mientras n8n sigue caído el barrido no inventa nada.
    let r = await barrerBandeja();
    expect(r.avisosCompletados).toBe(0);
    expect(r.avisosSinConfirmar).toBe(1);
    expect(mundo.envios).toEqual([]);
    // n8n vuelve.
    mundo.celular = 'enviado';
    r = await barrerBandeja();
    expect(r.avisosCompletados).toBe(1);
    expect(mundo.envios).toHaveLength(1);
    const p = await pendiente();
    expect(p).toMatchObject({ estado_bot: 'pausado', aviso_pendiente: null, aviso_pendiente_at: null });
    expect((await atendidoAt()).every((x) => x !== null)).toBe(true);
  });

  it('si una persona tomó la conversación mientras el aviso estaba pendiente, al completarse no la pisa ni le escribe al huésped', async () => {
    const id = await crearCliente('a', 1);
    const cfg = await clienteConfig('a');
    const { atenderYMarcar } = await import('../../src/ingesta/procesarEntrante.js');
    mundo.celular = 'fallido';
    await guardarEntranteDurable(cfg, aviso(501, 'quiero hablar con una persona'));
    await atenderYMarcar(cfg, {
      clienteId: cfg.id, chatwootConversationId: 7, textoAgrupado: 'quiero hablar con una persona',
      mensajes: [{ clienteId: cfg.id, chatwootAccountId: 1, chatwootConversationId: 7, chatwootContactId: 5, chatwootMessageId: 501, canal: 'whatsapp', telefono: '573001234567', contenido: 'quiero hablar con una persona', tipo: 'texto', recibidoAt: new Date().toISOString() }],
    });
    await supabase.from('conversaciones').update({ estado_bot: 'pausado', motivo_escalamiento: 'agente_respondio' }).eq('cliente_id', id);
    mundo.celular = 'enviado';
    await barrerBandeja();
    expect(mundo.envios).toEqual([]);
    const p = await pendiente();
    expect(p.estado_bot).toBe('pausado');
    expect(p.aviso_pendiente).toBeNull();
    const m = await supabase.from('conversaciones').select('motivo_escalamiento').eq('cliente_id', id).maybeSingle();
    expect((m.data as { motivo_escalamiento: string }).motivo_escalamiento).toBe('agente_respondio');
  });

  it('Chatwoot (nota) y n8n caídos a la vez a los 15 min: queda pendiente y se sigue intentando, sin marcar atendido', async () => {
    await crearCliente('a', 1);
    await guardarEntranteDurable(await clienteConfig('a'), aviso(501, 'ya pagué'));
    await envejecer(20);
    mundo.notaFalla = true;
    mundo.celular = 'fallido';
    const r = await barrerBandeja();
    expect(r.escaladas).toBe(0);
    const p = await pendiente();
    expect(p.aviso_pendiente_at).not.toBeNull();
    expect((await atendidoAt()).every((x) => x === null)).toBe(true);
    // Todo vuelve: el siguiente barrido completa y marca atendido.
    mundo.notaFalla = false;
    mundo.celular = 'enviado';
    const r2 = await barrerBandeja();
    expect(r2.avisosCompletados).toBe(1);
    expect((await atendidoAt()).every((x) => x !== null)).toBe(true);
  });
});
