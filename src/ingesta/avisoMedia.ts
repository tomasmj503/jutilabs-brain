import { redis } from '../db/redis.js';
import type { TipoMensaje } from '../types/index.js';

/** Cada mensaje saliente cuesta en Meta: al huésped se le pide "escríbeme" una vez por ventana. */
export const VENTANA_MEDIA_SEGUNDOS = 600;

/** True solo la primera vez dentro de la ventana, por conversación. */
export async function debeAvisarMedia(conversacionId: string): Promise<boolean> {
  const primera = await redis.set(`media:${conversacionId}`, '1', 'EX', VENTANA_MEDIA_SEGUNDOS, 'NX');
  return primera !== null;
}

const DESCRIPCION: Record<TipoMensaje, string> = {
  texto: 'un mensaje', audio: 'un audio', imagen: 'una imagen', video: 'un video',
  documento: 'un documento', ubicacion: 'una ubicación', otro: 'un archivo',
};

/** "un audio", "un audio y una imagen", "un audio, una imagen y un video". */
export function descripcionMedia(tipos: TipoMensaje[]): string {
  const unicas = [...new Set(tipos.map((t) => DESCRIPCION[t]))];
  if (unicas.length <= 1) return unicas[0] ?? DESCRIPCION.otro;
  return `${unicas.slice(0, -1).join(', ')} y ${unicas[unicas.length - 1]}`;
}
