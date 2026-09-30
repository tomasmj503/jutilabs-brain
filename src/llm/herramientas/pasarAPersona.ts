import type { HerramientaLLM } from '../../types/index.js';

/** Nombre de la herramienta. Lo comparten el prompt, la ingesta y la prueba de LLM. */
export const HERRAMIENTA_PASAR_A_PERSONA = 'pasar_a_persona';

/**
 * El modelo la llama cuando el huésped necesita a una persona (algo que el bot no puede resolver ni decidir).
 * NO manda nada por sí sola: solo deja constancia. Después de enviar la respuesta del modelo, la ingesta avisa al equipo
 * y pausa el bot (mismo camino que un tema de alto valor). A diferencia de [[NO_SE]], la respuesta del modelo SÍ se envía.
 */
export const pasarAPersona: HerramientaLLM<{ motivo?: string }> = {
  nombre: HERRAMIENTA_PASAR_A_PERSONA,
  descripcion:
    'Avisa al equipo para que una persona continúe la conversación (grupos, eventos de empresa, reembolsos, descuentos, quejas, '
    + 'o cualquier cosa que tú no puedas resolver o decidir). Úsala JUNTO con tu respuesta: primero responde lo que sí sepas.',
  parametros: {
    type: 'object',
    properties: {
      motivo: { type: 'string', description: 'Motivo en pocas palabras (opcional)' },
    },
    required: [],
  },
  async ejecutar() {
    return { ok: true, nota: 'El equipo será avisado después de tu respuesta. Responde con lo que sí sepas y dile que una persona del equipo continuará.' };
  },
};
