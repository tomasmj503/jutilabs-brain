import type { Idioma } from '../types/index.js';

/** Minúsculas, sin tildes ni signos: "¡Sí!" y "si" cuentan igual. */
export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const SALUDOS = /^(hola|holi|holis|buenas|buenos dias|buen dia|buenas tardes|buenas noches|hello|hi|hey|good morning|good afternoon|good evening|saludos)$/;

/** Saludo simple, sin pregunta. */
export function esSoloSaludo(texto: string): boolean {
  return SALUDOS.test(normalizar(texto));
}

const EN = new Set([
  'the', 'and', 'you', 'is', 'are', 'do', 'does', 'have', 'how', 'what', 'where', 'when', 'much', 'many',
  'room', 'rooms', 'book', 'booking', 'night', 'nights', 'please', 'thanks', 'thank', 'can', 'could',
  'would', 'want', 'need', 'there', 'with', 'for', 'from', 'class', 'classes', 'hello', 'hi', 'hey',
  'your', 'price', 'prices', 'available', 'availability', 'human', 'person', 'someone', 'somebody', 'talk', 'speak', 'manager',
]);
const ES = new Set([
  'el', 'la', 'los', 'las', 'de', 'que', 'y', 'es', 'en', 'un', 'una', 'por', 'para', 'con', 'hola',
  'buenas', 'cuanto', 'cuesta', 'cuestan', 'precio', 'precios', 'habitacion', 'habitaciones', 'reserva',
  'reservar', 'quiero', 'necesito', 'tienen', 'hay', 'como', 'donde', 'cuando', 'gracias', 'favor',
  'puedo', 'puede', 'tiene', 'clase', 'clases', 'noche', 'noches', 'disponible', 'disponibilidad',
]);

/**
 * Palabras frecuentes y distintivas de portugués, francés, alemán e italiano (el texto ya viene normalizado: sin tildes).
 * No es un detector de idiomas completo: solo reconoce «claramente no es español ni inglés». Heurística de la Fase 1.
 */
const OTRO = new Set([
  // portugués
  'voce', 'obrigado', 'obrigada', 'nao', 'quanto', 'custa', 'quero', 'uma', 'muito', 'tem', 'preciso', 'pode', 'onde', 'diaria',
  // francés
  'bonjour', 'bonsoir', 'merci', 'je', 'vous', 'pour', 'une', 'quel', 'quelle', 'combien', 'chambre', 'avez', 'voudrais', 'oui', 'coute', 'est',
  // alemán
  'hallo', 'danke', 'ich', 'sie', 'und', 'nicht', 'haben', 'zimmer', 'wie', 'viel', 'kostet', 'bitte', 'guten', 'tag', 'mochte', 'ein', 'eine', 'ist',
  // italiano
  'ciao', 'grazie', 'buongiorno', 'vorrei', 'costa', 'camera', 'avete', 'favore', 'prego', 'sono', 'prenotare',
]);

/**
 * Idioma del mensaje. Con empate o sin señales se queda el actual; nunca devuelve uno no permitido.
 * Un texto claramente en OTRO idioma (ni es ni en) se trata como inglés (#17 / situación 06 del manual).
 */
export function detectarIdioma(texto: string, actual: Idioma, permitidos: Idioma[]): Idioma {
  let en = 0;
  let es = 0;
  let otro = 0;
  for (const palabra of normalizar(texto).split(' ')) {
    if (EN.has(palabra)) en++;
    if (ES.has(palabra)) es++;
    if (OTRO.has(palabra)) otro++;
  }
  // «Claramente otro idioma»: al menos 2 marcas y más que las de español e inglés (una palabra suelta no cambia nada).
  const esOtroIdioma = otro >= 2 && otro > en && otro > es;
  const detectado: Idioma = esOtroIdioma ? 'en' : en > es ? 'en' : es > en ? 'es' : actual;
  return permitidos.includes(detectado) ? detectado : actual;
}
