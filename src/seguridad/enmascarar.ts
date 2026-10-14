/**
 * Datos que no deben quedar en la base, en las notas del equipo, en Telegram, en el modelo ni en los logs (PC-19, V-23).
 * Se aplica UNA vez, al entrar el mensaje (procesarEntrante.ts): todo lo que sale de ahí ya viene limpio.
 */

const TARJETA = '[número de tarjeta oculto]';
const CLAVE = '[dato secreto oculto]';

// 13 a 19 dígitos, con espacios o guiones entre ellos. Sin Luhn a propósito: es mejor ocultar de más.
const POSIBLE_TARJETA = /(?<![\d-])\d(?:[ -]?\d){12,18}(?![\d-])/g;

// «mi clave es X», «password: X», «contraseña = X». Exige el verbo/signo: «¿cuál es la clave del wifi?» no se toca.
const CLAVE_CON_VALOR = /\b(clave|contrase(?:ñ|n)a|password|passcode|pin|cvv2?|cvc)\b(\s*(?:es|is|:|=)\s*)(\S+)/gi;
// «pin 4321», «cvv 123»: palabra de código + 3 a 8 dígitos.
const CODIGO_CON_DIGITOS = /\b(pin|cvv2?|cvc)\b(\s+)(\d{3,8})\b/gi;

/** Oculta números de tarjeta (13 a 19 dígitos) y claves dichas con su nombre. Idempotente. */
export function enmascararSensibles(texto: string): string {
  return texto
    .replace(POSIBLE_TARJETA, (m) => {
      const digitos = m.replace(/\D/g, '').length;
      return digitos >= 13 && digitos <= 19 ? TARJETA : m;
    })
    .replace(CLAVE_CON_VALOR, (m, palabra: string, union: string, valor: string) =>
      valor === CLAVE || valor.startsWith('[dato') ? m : `${palabra}${union}${CLAVE}`)
    .replace(CODIGO_CON_DIGITOS, (_m, palabra: string, espacio: string) => `${palabra}${espacio}${CLAVE}`);
}

/** Teléfono para los logs: solo los últimos 4 dígitos. */
export function enmascararTelefono(telefono: string | null): string {
  if (telefono === null) return 'null';
  const digitos = telefono.replace(/\D/g, '');
  return digitos.length <= 4 ? '***' : `***${digitos.slice(-4)}`;
}
