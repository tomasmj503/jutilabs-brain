import type { ClienteConfig } from '../types/index.js';

const DEFECTO = {
  // Texto del manual para el pase a persona. SIN promesas de tiempo. (La versión en inglés no está en el manual: traducción literal.)
  mensajeAcuse: {
    es: 'Ya compartí tu solicitud con el equipo.',
    en: "I've shared your request with the team.",
  },
  mensajeNoEntendi: {
    es: 'No te entendí bien 🙏 ¿Me lo cuentas de otra forma? Puedo ayudarte con habitaciones, clases de yoga, café y eventos.',
    en: "I didn't quite get that 🙏 Could you say it another way? I can help with rooms, yoga classes, the café and events.",
  },
  mensajeNoSeElDato: {
    es: 'Quiero darte la información correcta 🙏 Déjame pasar esta consulta a nuestro equipo para confirmarla.',
    en: 'I want to give you the right information 🙏 Let me pass this to our team to confirm it.',
  },
  mensajeMedia: {
    // Sin pregunta de sí/no ("¿me lo escribes?" haría que un "sí" fuera ambiguo) y con la frase EXACTA que activa
    // la regla pidioHumano. Una prueba (avisoMediaTexto.test.ts) asegura que esa frase siga activándola.
    es: 'Por ahora solo puedo leer mensajes de texto 🙏 Escríbeme lo que necesitas o, si prefieres hablar con una persona, escribe «quiero hablar con una persona» y te paso con el equipo.',
    en: "For now I can only read text messages 🙏 Please type what you need or, if you'd rather talk to a person, write \"I want to talk to a person\" and I'll pass you to our team.",
  },
  mensajeHumano: {
    es: 'Ya compartí tu solicitud con el equipo.',
    en: "I've shared your request with the team.",
  },
  // Saludo del manual cuando la base no trae config_extra.saludo. (Inglés: traducción literal.)
  saludo: {
    es: 'Hola, me llamo Max, ¿en qué te puedo ayudar?',
    en: "Hi, I'm Max, how can I help you?",
  },
} as const;

/**
 * Otras claves de configExtra donde también puede venir el texto. `mensaje_escalamiento` (columna de clientes, ya
 * cargada en configExtra.mensajeEscalamiento) es el texto propio del cliente para el pase a persona (V-25).
 */
const ALTERNATIVAS: Partial<Record<keyof typeof DEFECTO, readonly string[]>> = {
  mensajeHumano: ['mensajeEscalamiento'],
};

/** Texto fijo por idioma: primero el de Supabase (configExtra.<clave>); si no existe, el de aquí. */
export function textoFijo(cfg: ClienteConfig, clave: keyof typeof DEFECTO, idioma: string): string {
  for (const k of [clave, ...(ALTERNATIVAS[clave] ?? [])]) {
    const m = cfg.configExtra[k] as Record<string, unknown> | null | undefined;
    const texto = m?.[idioma];
    if (typeof texto === 'string' && texto.trim()) return texto;
  }
  return idioma === 'en' ? DEFECTO[clave].en : DEFECTO[clave].es;
}
