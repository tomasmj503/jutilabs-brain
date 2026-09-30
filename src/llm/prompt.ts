import type { ClienteConfig, ContextoConversacion } from '../types/index.js';
import { HERRAMIENTA_PASAR_A_PERSONA } from './herramientas/pasarAPersona.js';

const MARCA_NO_SE = '[[NO_SE]]';

export function construirSystemPrompt(
  cfg: ClienteConfig, conv: ContextoConversacion, esSaludo = false,
): string {
  const idioma = conv.idioma === 'en' ? 'inglés' : 'español';
  const ahora = new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: cfg.zonaHoraria,
  }).format(new Date());

  const partes: string[] = [
    cfg.promptBase.trim(),
    `IDENTIDAD\nTe llamas ${cfg.nombreBot}. Eres un asistente virtual, no una persona; si te preguntan, lo dices.`,
    `IDIOMA\nResponde en ${idioma}. Si el huésped escribe en otro de estos idiomas (${cfg.idiomas.join(', ')}), responde en ese.`,
    `FECHA Y HORA ACTUAL\n${ahora}`,
    `REGLAS DURAS\n- Nunca inventes datos. Nunca digas que algo es gratis, sin costo o está incluido si no aparece en los datos.\n- Responde con UN solo mensaje corto.\n`
    + `- Si no tienes NINGÚN dato para responder, escribe al final exactamente ${MARCA_NO_SE}. Si tienes el dato o parte de él, respóndelo y NO escribas ${MARCA_NO_SE}.\n`
    + `- Si el huésped necesita a una persona (algo que tú no puedes resolver o decidir: reembolsos, descuentos, grupos, eventos, quejas, un tema de la lista de abajo) o le falta un dato que tú no tienes, `
    + `primero consulta las herramientas de información y responde con TODO lo que sepas (datos, precios, fechas); después llama a ${HERRAMIENTA_PASAR_A_PERSONA} y termina diciendo que una persona del equipo continuará. `
    + `${HERRAMIENTA_PASAR_A_PERSONA} NO reemplaza tu respuesta; si pudiste responder por completo, no la llames. Nunca prometas "voy a pasar tu consulta al equipo" sin llamarla: sin la herramienta nadie recibe el aviso.\n`
    + `- Si el mensaje no tiene nada que ver con este negocio, responde con amabilidad que solo puedes ayudar con sus temas y NO escribas ${MARCA_NO_SE}.`,
  ];

  if (esSaludo) {
    partes.push('SALUDO\nEl huésped solo saludó, sin preguntar nada. Responde SOLO con un saludo breve e invítalo a preguntar. No des precios, horarios ni ningún otro dato, aunque los sepas.');
  }

  if (cfg.temasQueEscalan.length > 0) {
    partes.push(
      `TEMAS QUE PASAN A UNA PERSONA\n${cfg.temasQueEscalan.join(', ')}\n`
      + `Si el huésped toca alguno de estos temas, responde con la información real que tengas (consulta las herramientas) y después llama a ${HERRAMIENTA_PASAR_A_PERSONA}. `
      + `NO escribas ${MARCA_NO_SE} solo por eso: escríbelo únicamente si además no tienes ningún dato útil.`,
    );
  }

  return partes.join('\n\n');
}
