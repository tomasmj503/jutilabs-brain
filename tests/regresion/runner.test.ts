import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// ---- Los bordes del cerebro (Supabase, Redis, Chatwoot, n8n, OpenRouter) se reemplazan por fakes. ----
vi.mock('../../src/config/env.js', () => ({
  env: { BUFFER_MS: 0, LOCK_TTL_MS: 2000, CHATWOOT_BASE_URL: 'http://chatwoot.test', N8N_WEBHOOK_AVISOS: 'http://n8n.test', N8N_WEBHOOK_SECRET: 's' },
  secretoPorRef: () => 'x',
}));
vi.mock('../../src/db/supabase.js', async () => ({ supabase: (await import('./fakes/supabase.js')).supabaseFalso }));
vi.mock('../../src/db/redis.js', async () => ({ redis: (await import('../unitarias/redisFalso.js')).redisFalso }));
vi.mock('../../src/salida/chatwoot.js', async () => {
  const { mundo } = await import('./fakes/mundo.js');
  return {
    enviarMensaje: async (_c: unknown, _n: number, texto: string) => {
      if (mundo.chatwootCaido) throw new Error('Chatwoot caído');
      mundo.enviosAlHuesped.push(texto);
      return 1000 + mundo.enviosAlHuesped.length;
    },
    enviarNotaPrivada: async (_c: unknown, _n: number, texto: string) => { mundo.notasPrivadas.push(texto); },
    marcarAbierta: async () => { mundo.conversacionesAbiertas++; },
    idUsuarioBot: async () => 1,
  };
});
vi.mock('../../src/salida/avisoEquipo.js', async () => {
  const { mundo } = await import('./fakes/mundo.js');
  return { avisarAlCelular: async (_c: unknown, _n: number, nota: string) => { mundo.avisosAlEquipo.push(nota); return 'enviado' as const; } };
});
vi.mock('../../src/llm/conReintento.js', async () => {
  const { mundo } = await import('./fakes/mundo.js');
  return {
    llamarLLMConReintento: async () => {
      mundo.llamadasAlModelo++;
      const paso = mundo.guion.shift() ?? { texto: 'Respuesta del modelo simulado.' };
      if (paso.error) {
        throw Object.assign(new Error(paso.error.mensaje ?? 'fallo simulado'), paso.error.status ? { status: paso.error.status } : {});
      }
      return {
        texto: paso.texto ?? '', modelo: 'simulado', tokensEntrada: 1, tokensSalida: 1, latenciaMs: 1,
        herramientasUsadas: paso.herramientas ?? [], proveedores: [], noSeElDato: paso.noSeElDato ?? false,
      };
    },
  };
});

const { base } = await import('./fakes/supabase.js');
const { mundo } = await import('./fakes/mundo.js');
const { limpiar } = await import('../unitarias/redisFalso.js');
const { atenderTurno, manejarFalloDeTurno } = await import('../../src/ingesta/atenderTurno.js');

// ---- Formato de un caso (tests/regresion/casos/*.json) ----
type Mensaje = { texto?: string; adjuntos?: string[] };
type Esperado = {
  mensajesAlHuesped?: number;
  /** Texto que NO puede aparecer en ningún mensaje al huésped. */
  noDiceAlHuesped?: string[];
  pausado?: boolean;
  avisosAlEquipo?: number;
  llamadasAlModelo?: number;
  conversacionesAbiertas?: number;
};
type Caso = {
  id: string;
  ref: string;
  descripcion: string;
  /** Punto de la Fase 1 que lo arregla: mientras no esté hecho el caso corre como `it.fails`. */
  pendiente?: string;
  cliente?: { temasQueEscalan?: string[]; idiomaDefault?: string };
  conversacion?: { estadoBot?: 'activo' | 'pausado'; escaladoHaceHoras?: number | null; motivo?: string };
  /** Si es true, Supabase está caído durante los turnos. */
  baseCaida?: boolean;
  turnos: Array<{ mensajes: Mensaje[]; modelo?: { texto?: string; herramientas?: string[]; noSeElDato?: boolean; error?: { status?: number } }; esperado?: Esperado }>;
  esperado: Esperado;
};

const CARPETA = join(import.meta.dirname, 'casos');
const casos: Caso[] = readdirSync(CARPETA).filter((f) => f.endsWith('.json')).sort()
  .map((f) => JSON.parse(readFileSync(join(CARPETA, f), 'utf8')) as Caso);

const CLIENTE_ID = 'cliente-regresion';
const CONVERSACION = 7;

function configurarCliente(c: Caso) {
  return {
    id: CLIENTE_ID, slug: 'regresion', nombre: 'Cliente de regresión', activo: true, botActivo: true,
    chatwootAccountId: 1, chatwootTokenRef: 'T', idiomas: ['es', 'en'], idiomaDefault: c.cliente?.idiomaDefault ?? 'es',
    zonaHoraria: 'America/Bogota', nombreBot: 'Max', promptBase: 'Prompt de prueba.', temasEnAlcance: [],
    temasQueEscalan: c.cliente?.temasQueEscalan ?? [], contactosEscalamiento: [], llmModelo: 'simulado',
    llmModeloRespaldo: null, llmTemperatura: 0.3, openrouterKeyRef: 'K', limiteMensajesDiaConversacion: 40,
    reactivacionHoras: 5, linkReservaBase: null, configExtra: {},
  } as never;
}

function sembrarConversacion(c: Caso): void {
  const conv = c.conversacion ?? {};
  const escalado = conv.escaladoHaceHoras === undefined || conv.escaladoHaceHoras === null
    ? null : new Date(Date.now() - conv.escaladoHaceHoras * 3_600_000).toISOString();
  base.tabla('conversaciones').push({
    id: 'conv-1', cliente_id: CLIENTE_ID, chatwoot_conversation_id: CONVERSACION, canal: 'whatsapp', idioma: 'es',
    pais: null, estado_bot: conv.estadoBot ?? 'activo', escalado_at: escalado, motivo_escalamiento: conv.motivo ?? null,
  });
}

let contadorMensajes = 100;
function armarTurno(mensajes: Mensaje[]) {
  const lista = mensajes.map((m) => ({
    clienteId: CLIENTE_ID, chatwootAccountId: 1, chatwootConversationId: CONVERSACION, chatwootContactId: 5,
    chatwootMessageId: ++contadorMensajes, canal: 'whatsapp' as const, telefono: '573000000000',
    contenido: m.texto ?? '', tipo: (m.adjuntos?.[0] ?? 'texto') as never, recibidoAt: new Date().toISOString(),
  }));
  return {
    clienteId: CLIENTE_ID, chatwootConversationId: CONVERSACION, mensajes: lista,
    textoAgrupado: lista.map((m) => m.contenido).filter(Boolean).join('\n'),
  };
}

/** Lo mismo que hace procesarEntrante dentro del candado: turno y, si falla, recuperación. */
async function correrTurno(cfg: never, turno: ReturnType<typeof armarTurno>): Promise<void> {
  try {
    await atenderTurno(cfg, turno as never);
  } catch (e) {
    await manejarFalloDeTurno(cfg, turno as never, e);
  }
}

function afirmar(e: Esperado): void {
  const conv = base.tabla('conversaciones').find((f) => f.chatwoot_conversation_id === CONVERSACION);
  if (e.mensajesAlHuesped !== undefined) expect(mundo.enviosAlHuesped, 'mensajes al huésped').toHaveLength(e.mensajesAlHuesped);
  for (const t of e.noDiceAlHuesped ?? []) {
    expect(mundo.enviosAlHuesped.join('\n').toLowerCase(), `no debe decir «${t}»`).not.toContain(t.toLowerCase());
  }
  if (e.pausado !== undefined) expect(conv?.estado_bot === 'pausado', 'pausado').toBe(e.pausado);
  if (e.avisosAlEquipo !== undefined) expect(mundo.avisosAlEquipo, 'avisos al equipo').toHaveLength(e.avisosAlEquipo);
  if (e.llamadasAlModelo !== undefined) expect(mundo.llamadasAlModelo, 'llamadas al modelo').toBe(e.llamadasAlModelo);
  if (e.conversacionesAbiertas !== undefined) expect(mundo.conversacionesAbiertas, 'conversaciones abiertas').toBe(e.conversacionesAbiertas);
}

beforeEach(() => {
  base.reiniciar();
  mundo.reiniciar();
  limpiar();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('regresión: lo que decide el código con el modelo simulado', () => {
  it('hay casos cargados', () => {
    expect(casos.length).toBeGreaterThan(0);
  });

  for (const caso of casos) {
    const correr = async () => {
      sembrarConversacion(caso);
      const cfg = configurarCliente(caso);
      for (const turno of caso.turnos) {
        mundo.guion.push(turno.modelo ?? {});
        // La base se cae después de sembrar y antes del turno: el turno ve a Supabase caído.
        base.caida = caso.baseCaida === true;
        await correrTurno(cfg, armarTurno(turno.mensajes));
        base.caida = false;
        if (turno.esperado) afirmar(turno.esperado);
      }
      afirmar(caso.esperado);
    };
    const titulo = `${caso.id} (${caso.ref}): ${caso.descripcion}`;
    // Un caso pendiente DEBE fallar hoy; cuando el punto se arregla, falla "it.fails" y obliga a quitar la marca.
    // REGRESION_VER_PENDIENTES=1 los corre como pruebas normales para ver POR QUÉ fallan hoy.
    if (caso.pendiente && process.env.REGRESION_VER_PENDIENTES !== '1') it.fails(`${titulo} [pendiente ${caso.pendiente}]`, correr);
    else it(titulo, correr);
  }
});
