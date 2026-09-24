type Obj = Record<string, unknown>;
const o = (x: unknown): Obj => (x && typeof x === 'object' ? (x as Obj) : {});
const n = (x: unknown): number | null => (x === null || x === undefined || x === '' || !Number.isFinite(Number(x)) ? null : Number(x));
const t = (x: unknown): string | null => (typeof x === 'string' && x.trim() ? x.trim() : null);

export interface Aviso {
  evento: string | null; direccion: 'entrante' | 'saliente' | null; privado: boolean;
  messageId: number | null; conversationId: number | null; accountId: number | null;
  contactId: number | null; telefono: string | null;
  remitenteTipo: string | null; remitenteId: number | null; contenido: string;
  /** Estado del mensaje si el aviso lo trae (sent | delivered | read | failed). En Chatwoot 4.17.0 puede venir vacío. */
  estado: string | null;
  /** Motivo del rechazo que informa Meta (content_attributes.external_error), si viene. */
  errorExterno: string | null;
}

/** Lee el aviso de Chatwoot sin suponer nada: cada campo puede venir vacío. Registra qué llegó. */
export function leerAviso(cuerpo: unknown): Aviso {
  const c = o(cuerpo), conv = o(c.conversation), remitente = o(c.sender);
  const meta = o(o(conv.meta).sender), tipo = c.message_type;
  const tel = t(remitente.phone_number) ?? t(meta.phone_number) ?? t(o(conv.contact_inbox).source_id);
  const aviso: Aviso = {
    evento: t(c.event),
    direccion: tipo === 'incoming' || tipo === 0 ? 'entrante' : tipo === 'outgoing' || tipo === 1 ? 'saliente' : null,
    privado: c.private === true,
    messageId: n(c.id), conversationId: n(conv.id), accountId: n(o(c.account).id),
    contactId: n(meta.id) ?? (remitente.type === 'contact' ? n(remitente.id) : null),
    telefono: tel?.replace(/\D/g, '') || null,
    remitenteTipo: t(remitente.type), remitenteId: n(remitente.id), contenido: t(c.content) ?? '',
    estado: t(c.status), errorExterno: t(o(c.content_attributes).external_error),
  };
  // TEMPORAL (prueba): qué campos llegan de verdad. El texto del huésped no se registra, solo su largo.
  console.log(`AVISO ${JSON.stringify({ ...aviso, contenido: aviso.contenido.length })} claves=${Object.keys(c).join(',')} remitente=${Object.keys(remitente).join(',')}`);
  return aviso;
}
