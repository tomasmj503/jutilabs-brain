/**
 * Tope DURO de un turno con el modelo (ADR-11): las llamadas al modelo de un turno (con su reintento y su respaldo)
 * comparten una señal que se aborta a los 90 s. El tope de 25 s del SDK no cubre toda la respuesta (V-14).
 * apagado.ts y stop_grace_period dependen de este número.
 */
export const TOPE_TURNO_MS = 90_000;
