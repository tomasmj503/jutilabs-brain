import type { MotivoEscalamiento } from '../types/index.js';

/** Por qué escaló el bot, tal como lo lee el equipo en la nota privada. */
export function causaDelEscalamiento(motivo: MotivoEscalamiento): string {
  if (motivo === 'error_interno') return 'falla técnica del bot (no fue falta de dato)';
  if (motivo === 'pidio_humano') return 'el huésped pidió hablar con una persona';
  if (motivo === 'limite_mensajes') {
    return 'la conversación llegó al tope diario de mensajes del bot (revisar si es un bucle o una conversación muy larga)';
  }
  return 'no tenía el dato para responder';
}
