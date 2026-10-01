import type { MotivoEscalamiento } from '../types/index.js';
import { HERRAMIENTA_PASAR_A_PERSONA } from '../llm/herramientas/pasarAPersona.js';

/** Quita tildes y mayúsculas para comparar frases sin sorpresas ("pasé" = "pase"). */
function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’‘]/g, "'");
}

const VERBOS_ES = 'confirma|confirmara|confirmaran|escribe|escribira|escribiran|contacta|contactara|contactaran|responde|respondera|responderan|llama|llamara|llamaran';

/**
 * Frases con las que el modelo PROMETE que una persona va a responder. Solo promesas, nunca ofertas:
 * "¿quieres que el equipo te confirme?" no cuenta, porque avisar ahí pausaría el bot antes de que el huésped conteste.
 * Y nunca la palabra "equipo" suelta: "el equipo te recibe en recepción" es una respuesta normal.
 * Cada frase nueva se agrega con su prueba en tests/unitarias/promesaSinAviso.test.ts.
 */
const PROMESAS: readonly RegExp[] = [
  // "paso tu consulta", "le paso tu consulta", "ya pasé tu solicitud", "voy a pasar tu consulta", "dejo tu consulta con el equipo"
  /\b(paso|pase|pasare|pasaremos|voy a pasar|vamos a pasar|dejo|deje|dejare|voy a dejar)\s+(tu|su)\s+(consulta|solicitud|pregunta|mensaje|caso|duda|pedido)\b/,
  // "el equipo te confirma", "una persona del equipo te escribe", "alguien te contactará"
  new RegExp(`\\b(equipo|persona|alguien|asesor|asesora|recepcion)\\b[^.!?\\n]{0,25}\\b(te|le|les)\\s+(${VERBOS_ES})\\b`),
  // "te van a escribir"
  /\b(te|le|les)\s+(va|van)\s+a\s+(escribir|contactar|llamar|confirmar|responder)\b/,
  // "te contactarán pronto"
  /\b(te|le|les)\s+(contactara|contactaran|escribira|escribiran|llamara|llamaran|confirmara|confirmaran|respondera|responderan)\b/,
  // "se pondrá en contacto contigo"
  /\bse\s+(pondra|pondran)\s+en\s+contacto\b/,
  // Inglés: "I'll pass your question to the team", "the team will get back to you"
  /\b(i'll|i will|i am going to|i'm going to)\s+(pass|forward|send)\s+(your|this)\s+(question|request|inquiry|message|query)\b/,
  /\b(team|someone|somebody|staff)\b[^.!?\n]{0,40}\b(will|is going to|'ll)\s+(get back|reach out|contact|be in touch|follow up|write|respond|message)\b/,
];

/** ¿El texto que salió al huésped promete que una persona va a responderle? */
export function promesaDePasarConsulta(texto: string): boolean {
  // Oración por oración. Si antes de la promesa hay un "si ..." / "if ...", depende de que el huésped conteste primero
  // ("Si me compartes tus fechas, el equipo te confirma el valor"): no se avisa todavía. Una pregunta ("¿Quieres que pase tu caso al equipo?") es una oferta: tampoco. "Sí, paso tu consulta" (con coma) sí cuenta.
  return normalizar(texto).split(/(?<=[.!?])\s+|\n+/).some((oracion) =>
    PROMESAS.some((p) => [...oracion.matchAll(new RegExp(p.source, 'g'))].some((m) => !/\b(si|if)\s|¿/.test(oracion.slice(0, m.index)))));
}

/**
 * ¿Hay que avisar al equipo y pausar el bot DESPUÉS de enviar la respuesta del modelo?
 * Sí si el router detectó un tema de alto valor (ese motivo manda, para no avisar dos veces), si el propio modelo
 * llamó a la herramienta pasar_a_persona, o si el texto que salió promete que una persona responderá (red de seguridad:
 * el modelo a veces lo promete sin llamar a la herramienta y nadie recibía el aviso).
 * `textoEnviado` es el texto que SÍ llegó al huésped; no se pasa cuando salió un mensaje fijo en su lugar.
 * Reutiliza el motivo 'fuera_de_alcance' para no tocar la base de datos.
 */
export function motivoParaAvisarAlEquipo(
  temaAltoValor: MotivoEscalamiento | null, herramientasUsadas: readonly string[], textoEnviado?: string,
): MotivoEscalamiento | null {
  if (temaAltoValor) return temaAltoValor;
  if (herramientasUsadas.includes(HERRAMIENTA_PASAR_A_PERSONA)) return 'fuera_de_alcance';
  return avisoPorRedDeSeguridad(temaAltoValor, herramientasUsadas, textoEnviado) ? 'fuera_de_alcance' : null;
}

/**
 * ¿El aviso al equipo lo provoca SOLO la red de seguridad? Ni el router (tema de alto valor) ni el modelo
 * (herramienta pasar_a_persona) pidieron a una persona, pero el texto que salió al huésped lo promete.
 * Es la única regla de la red: motivoParaAvisarAlEquipo y el log del piloto usan esta misma función.
 */
export function avisoPorRedDeSeguridad(
  temaAltoValor: MotivoEscalamiento | null, herramientasUsadas: readonly string[], textoEnviado?: string,
): boolean {
  if (temaAltoValor || herramientasUsadas.includes(HERRAMIENTA_PASAR_A_PERSONA)) return false;
  return !!textoEnviado && promesaDePasarConsulta(textoEnviado);
}
