import type { FastifyInstance } from 'fastify';
import { redis } from '../db/redis.js';
import { supabase } from '../db/supabase.js';
import { cargarClientesActivos } from '../config/cliente.js';
import { contarAvisosSinConfirmar } from '../conversacion/avisoPendiente.js';
import { edadDelLatido, LATIDO_MAXIMO_MS } from './salud.js';

/**
 * GET /health/ready — SOLO para el monitor externo (UptimeRobot / Healthchecks). Dice si el cerebro está en condiciones
 * de atender, no si el proceso vive: eso es /health (el HEALTHCHECK de Docker). NADA interno consume /health/ready
 * ni reinicia el contenedor por él: un aviso que no sale no debe tumbar el bot.
 *
 * 503 si: Redis no responde, Supabase no responde, el barrido de la bandeja no late hace más de 3 min, o hay avisos al
 * equipo sin confirmar hace más de 15 min (PC-15: «que quede visible»).
 */
export const AVISO_SIN_CONFIRMAR_MAXIMO_MS = 15 * 60_000;

export type Dependencias = {
  pingRedis: () => Promise<void>;
  consultarSupabase: () => Promise<void>;
  edadLatidoBandejaMs: () => number | null;
  avisosSinConfirmar: () => Promise<number>;
};

export type EstadoListo = {
  ok: boolean;
  redis: 'ok' | 'falla';
  supabase: 'ok' | 'falla';
  bandeja: { estado: 'ok' | 'sin_latido' | 'atrasada'; edadMs: number | null };
  avisosSinConfirmar: number | 'desconocido';
};

const conTope = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<T>((_, no) => setTimeout(() => no(new Error(`sin respuesta en ${ms} ms`)), ms).unref())]);

export async function evaluarListo(d: Dependencias): Promise<EstadoListo> {
  const [r, s, a] = await Promise.allSettled([
    conTope(d.pingRedis(), 2_000), conTope(d.consultarSupabase(), 4_000), conTope(d.avisosSinConfirmar(), 5_000),
  ]);
  const edad = d.edadLatidoBandejaMs();
  const bandeja: EstadoListo['bandeja'] = {
    estado: edad === null ? 'sin_latido' : edad > LATIDO_MAXIMO_MS ? 'atrasada' : 'ok',
    edadMs: edad,
  };
  const avisos: EstadoListo['avisosSinConfirmar'] = a.status === 'fulfilled' ? a.value : 'desconocido';
  const estado: EstadoListo = {
    ok: false,
    redis: r.status === 'fulfilled' ? 'ok' : 'falla',
    supabase: s.status === 'fulfilled' ? 'ok' : 'falla',
    bandeja,
    avisosSinConfirmar: avisos,
  };
  // Si Supabase no responde ya está marcado; «desconocido» por sí solo no tumba el estado.
  estado.ok = estado.redis === 'ok' && estado.supabase === 'ok' && bandeja.estado === 'ok'
    && (avisos === 'desconocido' || avisos === 0);
  return estado;
}

export function dependenciasReales(): Dependencias {
  return {
    pingRedis: async () => {
      const r = await redis.ping();
      if (r !== 'PONG') throw new Error(`PING respondió ${r}`);
    },
    consultarSupabase: async () => {
      const { error } = await supabase.from('clientes').select('id', { head: true, count: 'exact' }).limit(1);
      if (error) throw new Error(error.message);
    },
    edadLatidoBandejaMs: () => edadDelLatido('bandeja'),
    avisosSinConfirmar: async () => {
      let total = 0;
      for (const cfg of await cargarClientesActivos()) {
        total += await contarAvisosSinConfirmar(cfg, AVISO_SIN_CONFIRMAR_MAXIMO_MS);
      }
      return total;
    },
  };
}

export async function registrarSalud(app: FastifyInstance, deps: Dependencias = dependenciasReales()): Promise<void> {
  app.get('/health/ready', async (_req, reply) => {
    const estado = await evaluarListo(deps);
    if (!estado.ok) console.error(`HEALTH/READY NO LISTO ${JSON.stringify(estado)}`);
    return reply.code(estado.ok ? 200 : 503).send(estado);
  });
}
