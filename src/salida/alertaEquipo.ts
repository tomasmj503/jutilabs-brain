import type { ClienteConfig } from '../types/index.js';
import { enviarNotaPrivada, marcarAbierta } from './chatwoot.js';
import { avisarAlCelular, type ResultadoAviso } from './avisoEquipo.js';

/** Repite un paso una vez (nota, abrir, pausar) y dice si salió. Nunca lanza. */
export async function conUnReintento(paso: string, conversationId: number, f: () => Promise<void>): Promise<boolean> {
  for (let intento = 1; intento <= 2; intento++) {
    try {
      await f();
      return true;
    } catch (e) {
      console.error(`ESCALAMIENTO FALLÓ paso=${paso} intento=${intento} conv=${conversationId}:`, e instanceof Error ? e.message : e, (e as { cause?: unknown })?.cause);
    }
  }
  return false;
}

export type ResultadoAlerta = {
  /** La nota privada quedó en la conversación. */
  nota: boolean;
  celular: ResultadoAviso;
  /**
   * El equipo QUEDÓ avisado de forma confirmada: n8n respondió 2xx, o (si el cliente no tiene grupo de avisos) la nota
   * privada se creó. Es la única condición para decirle al huésped que el equipo ya tiene su solicitud (PC-15).
   */
  avisado: boolean;
};

/**
 * Avisa al equipo: nota privada, (opcional) abre la conversación para que se vea, y aviso al celular.
 * NUNCA lanza. Devuelve qué salió, para que quien llama no afirme algo que no pasó.
 */
export async function alertarAlEquipo(
  cfg: ClienteConfig, conversationId: number, nota: string, opciones: { abrir?: boolean } = {},
): Promise<ResultadoAlerta> {
  const notaOk = await conUnReintento('nota', conversationId, () => enviarNotaPrivada(cfg, conversationId, nota));
  if (opciones.abrir) await conUnReintento('abrir', conversationId, () => marcarAbierta(cfg, conversationId));
  const celular = await avisarAlCelular(cfg, conversationId, nota);
  return { nota: notaOk, celular, avisado: celular === 'enviado' || (celular === 'sin_canal' && notaOk) };
}
