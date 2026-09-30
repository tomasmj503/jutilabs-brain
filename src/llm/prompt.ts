import type { ClienteConfig, ContextoConversacion } from '../types/index.js';

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
    `REGLAS DURAS\n- Nunca inventes datos.\n- Responde con UN solo mensaje corto.\n- Si no tienes el dato, escribe al final exactamente ${MARCA_NO_SE} y avisa que pasarás la consulta al equipo. Si tienes el dato, respóndelo y NO escribas ${MARCA_NO_SE}.`,
  ];

  if (esSaludo) {
    partes.push('SALUDO\nEl huésped solo saludó, sin preguntar nada. Responde SOLO con un saludo breve e invítalo a preguntar. No des precios, horarios ni ningún otro dato, aunque los sepas.');
  }

  if (cfg.temasQueEscalan.length > 0) {
    partes.push(
      `TEMAS QUE PASAN A UNA PERSONA\n${cfg.temasQueEscalan.join(', ')}\n`
      + `Si el huésped toca alguno de estos temas, responde con la información real que tengas (consulta las herramientas) y NO escribas ${MARCA_NO_SE} solo por eso: `
      + `el sistema pasa la conversación a una persona automáticamente después de tu respuesta. Escribe ${MARCA_NO_SE} únicamente si además te falta el dato.`,
    );
  }

  return partes.join('\n\n');
}
