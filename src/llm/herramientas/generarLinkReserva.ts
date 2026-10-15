import type { HerramientaLLM } from '../../types/index.js';

function fechaReal(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
const entre = (n: number, a: number, b: number) => Number.isInteger(n) && n >= a && n <= b;

/**
 * #1 / PC-16 (UNI-LINK): el link solo puede apuntar a un dominio de `config_extra.dominios_permitidos` del cliente
 * (host EXACTO y https). Falla CERRADA: sin lista, o con un host que no está, no hay link. Así un dato mal cargado
 * (otro motor, un dominio inventado) no llega al huésped.
 */
export function dominioPermitido(base: string, permitidos: unknown): boolean {
  if (!Array.isArray(permitidos)) return false;
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  return permitidos.some((d) => {
    if (typeof d !== 'string' || d.trim() === '') return false;
    const limpio = d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    return limpio === host;
  });
}
/** Arma cfg.linkReservaBase + &arrival=AAAA-MM-DD&nights=N&guests=N. Valida fechas futuras. No confirma reservas. */
export const generarLinkReserva: HerramientaLLM<{ llegada?: string; noches?: number; huespedes?: number }> = {
  nombre: 'generar_link_reserva',
  descripcion: 'Genera el link de reserva directa, con fechas y huéspedes si el huésped los dio. No confirma reservas ni disponibilidad',
  parametros: {
    type: 'object',
    properties: {
      llegada: { type: 'string', description: 'Fecha de llegada AAAA-MM-DD (hoy o futura)' },
      noches: { type: 'integer', description: 'Número de noches (1 a 30)' },
      huespedes: { type: 'integer', description: 'Número de huéspedes (1 a 20)' },
    },
    required: [],
  },
  async ejecutar(args, ctx) {
    const base = ctx.cfg.linkReservaBase;
    if (!base) return { error: 'No hay link de reserva configurado. No inventes ningún link: dile al huésped que una persona del equipo le ayudará con la reserva.' };
    if (!dominioPermitido(base, ctx.cfg.configExtra.dominios_permitidos)) {
      console.error(`LINK DE RESERVA BLOQUEADO cliente=${ctx.cfg.slug}: el dominio del link no está en config_extra.dominios_permitidos`);
      return { error: 'El link de reservas no está disponible en este momento. No inventes ningún link: dile al huésped que una persona del equipo le ayudará con la reserva.' };
    }
    const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: ctx.cfg.zonaHoraria }).format(new Date());
    if (args.llegada !== undefined && (!fechaReal(args.llegada) || args.llegada < hoy)) return { error: `Fecha inválida o pasada (hoy es ${hoy}). Pide una fecha futura.` };
    if (args.noches !== undefined && !entre(args.noches, 1, 30)) return { error: 'Noches inválidas (1 a 30). Pregunta de nuevo.' };
    if (args.huespedes !== undefined && !entre(args.huespedes, 1, 20)) return { error: 'Huéspedes inválidos (1 a 20). Pregunta de nuevo.' };
    const partes = [
      args.llegada !== undefined && `arrival=${args.llegada}`,
      args.noches !== undefined && `nights=${args.noches}`,
      args.huespedes !== undefined && `guests=${args.huespedes}`,
    ].filter(Boolean);
    const link = partes.length === 0 ? base : `${base}${base.includes('?') ? '&' : '?'}${partes.join('&')}`;
    return { link, nota: 'Es solo un enlace. No confirma la reserva ni la disponibilidad: eso se ve en la página de reservas.' };
  },
};
