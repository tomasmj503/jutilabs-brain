import type { ContextoConversacion } from '../types/index.js';
import { normalizar } from '../router/texto.js';

/**
 * True si la respuesta es idéntica a la última del bot y el huésped escribió algo distinto (el modelo se pegó al tema anterior).
 * Si el huésped repite su pregunta, repetir la respuesta es correcto.
 */
export function esRepeticion(conv: ContextoConversacion, respuesta: string, textoHuesped: string): boolean {
  const historial = conv.ultimosMensajes;
  const ultimoBot = [...historial].reverse().find((m) => m.rol === 'bot');
  const ultimoHuesped = [...historial].reverse().find((m) => m.rol === 'huesped');
  if (!ultimoBot || !ultimoHuesped) return false;
  const mismaRespuesta = normalizar(respuesta) === normalizar(ultimoBot.contenido);
  return mismaRespuesta && normalizar(textoHuesped) !== normalizar(ultimoHuesped.contenido);
}
