/**
 * "El mundo de afuera" de la regresión: lo que el cerebro le manda a Chatwoot, a n8n/Telegram y a OpenRouter,
 * registrado para poder afirmar sobre ello. Un solo objeto compartido entre los vi.mock del runner.
 */
export type GuionModelo = {
  texto?: string;
  herramientas?: string[];
  noSeElDato?: boolean;
  /** Si viene, el modelo "falla" con este estado HTTP (o sin estado = corte de red). */
  error?: { status?: number; mensaje?: string };
};

export const mundo = {
  enviosAlHuesped: [] as string[],
  notasPrivadas: [] as string[],
  conversacionesAbiertas: 0,
  avisosAlEquipo: [] as string[],
  llamadasAlModelo: 0,
  guion: [] as GuionModelo[],
  /** Pruebas del mundo: si es true, enviar al huésped falla. */
  chatwootCaido: false,
  reiniciar() {
    this.enviosAlHuesped.length = 0;
    this.notasPrivadas.length = 0;
    this.conversacionesAbiertas = 0;
    this.avisosAlEquipo.length = 0;
    this.llamadasAlModelo = 0;
    this.guion.length = 0;
    this.chatwootCaido = false;
  },
};
