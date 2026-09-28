import type { ReglaRouter } from '../../types/index.js';
import { normalizar } from '../texto.js';

/**
 * El huésped pide hablar con una persona. Se detecta con frases claras (verbo + persona), NUNCA con una
 * palabra suelta: "¿a qué hora abre la recepción?", "somos 3 personas" o "¿eres un bot?" no cuentan.
 * El texto llega normalizado (minúsculas, sin tildes ni signos: "pásame" → "pasame", "I'd" → "i d").
 * Si hace falta afinar, se agrega una frase aquí y su caso en tests/unitarias/pidioHumano.test.ts.
 */
const ART = String.raw`(?:(?:una|un|la|el|otra|otro|alguna|algun|su|tu)\s+){0,2}`;
const OBJETIVO_ES = 'persona|humano|humana|alguien|asesor|asesora|agente|recepcionista|encargado|encargada|responsable|gerente|dueno|duena|operador|operadora|representante|equipo|staff';
const OBJETIVO_EN = 'human|person|someone|somebody|agent|representative|rep|staff|manager|owner|receptionist|team|operator';

const PATRONES: RegExp[] = [
  // "quiero hablar con una persona", "pásame con el equipo", "me pueden comunicar con alguien"
  new RegExp(String.raw`\b(?:hablar|conversar|comunic\w+|contact\w+|chatear|charlar|pasar|pasarme|pasame|pasas|pasan|pasenme|pasarnos|transferir|transferirme|transfiereme|conectar|conectarme|conectame|derivar|derivarme|derivame)\s+(?:\w+\s+)?(?:con|a)\s+${ART}(?:${OBJETIVO_ES})\b`),
  // "necesito un humano", "prefiero un asesor" (una "persona" suelta NO cuenta: "quiero agregar una persona")
  new RegExp(String.raw`\b(?:quiero|quisiera|necesito|prefiero|busco|pido|requiero|queremos|necesitamos|preferimos)\s+(?:una?|otra?)\s+(?:persona real|humano|humana|asesor|asesora|recepcionista|representante|operador|operadora)\b`),
  // "que me atienda una persona", "que me llame alguien"
  new RegExp(String.raw`\b(?:que|para que)\s+(?:me\s+)?(?:atienda|atiendan|responda|respondan|conteste|contesten|llame|llamen|escriba|escriban|contacte|contacten|ayude|ayuden)\b(?:\s+\w+){0,2}?\s+(?:persona|humano|humana|alguien|asesor|asesora)\b`),
  // "no quiero hablar con un bot", "no quiero seguir hablando con un robot"
  new RegExp(String.raw`\bno\b(?:\s+\w+){0,3}?\s+(?:hablar|hablando|chatear|chateando|conversar|conversando|seguir|escribir|escribiendo|tratar)\b(?:\s+\w+){0,3}?\s+(?:bot|robot|chatbot|maquina|inteligencia artificial)\b`),
  // "can I speak to someone", "connect me with a human", "talk to the manager"
  new RegExp(String.raw`\b(?:talk|speak|chat|connect|transfer|escalate|pass|put)\s+(?:\w+\s+){0,2}?(?:to|with)\s+(?:(?:a|an|the|your|some)\s+)*(?:real\s+)?(?:${OBJETIVO_EN})\b`),
  // "I want a human", "I need a real person", "could I get a human"
  new RegExp(String.raw`\b(?:want|need|prefer|would like|d like|wanna|get)\s+(?:a|an)\s+(?:real\s+person|real\s+human|human|representative|receptionist|operator)\b`),
  // "I don't want to talk to a bot"
  new RegExp(String.raw`\b(?:not|don t|dont|do not|no)\s+(?:\w+\s+){0,3}?(?:talk|speak|chat)(?:ing)?\s+(?:\w+\s+){0,3}?(?:bot|robot|chatbot|machine)\b`),
  // Mensaje corto que ES el pedido: "humano", "un asesor por favor", "a real person"
  new RegExp(String.raw`^(?:(?:un|una|a|an)\s+)?(?:humano|humana|persona real|asesor humano|asesor|asesora|agente|operador|operadora|recepcionista|atencion humana|human|real person|real human|agent|representative|receptionist)(?:\s+(?:por favor|please|pls|porfa|porfavor))?$`),
];

/** True si el mensaje pide hablar con una persona. */
export function pideHumano(texto: string): boolean {
  const t = normalizar(texto);
  return t !== '' && PATRONES.some((p) => p.test(t));
}

export const reglaPidioHumano: ReglaRouter = {
  nombre: 'pidioHumano',
  async evaluar(turno) {
    // El texto de todos los mensajes del turno se evalúa por separado (no se mezclan frases de mensajes distintos).
    const pide = turno.mensajes.some((m) => pideHumano(m.contenido));
    return pide ? { tipo: 'escalar', motivo: 'pidio_humano', mensajeAlHuesped: null } : null;
  },
};
