import type { ClienteConfig } from '../types/index.js';

const DEFECTO = {
  mensajeAcuse: {
    es: 'Aquí sigo 🙏 Ya pasé tu consulta a nuestro equipo y te responden en cuanto puedan.',
    en: "I'm still here 🙏 I've passed your request to our team and they'll get back to you as soon as they can.",
  },
  mensajeNoEntendi: {
    es: 'No te entendí bien 🙏 ¿Me lo cuentas de otra forma? Puedo ayudarte con habitaciones, clases de yoga, café y eventos.',
    en: "I didn't quite get that 🙏 Could you say it another way? I can help with rooms, yoga classes, the café and events.",
  },
} as const;

/** Texto fijo por idioma: primero el de Supabase (configExtra.<clave>); si no existe, el de aquí. */
export function textoFijo(cfg: ClienteConfig, clave: keyof typeof DEFECTO, idioma: string): string {
  const m = cfg.configExtra[clave] as Record<string, unknown> | null | undefined;
  const texto = m?.[idioma];
  if (typeof texto === 'string' && texto.trim()) return texto;
  return idioma === 'en' ? DEFECTO[clave].en : DEFECTO[clave].es;
}
