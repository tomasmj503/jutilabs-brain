/** Chatwoot respondió con un error HTTP (4xx/5xx). */
export class ErrorChatwoot extends Error {
  readonly estado: number;
  constructor(mensaje: string, estado: number) {
    super(mensaje);
    this.name = 'ErrorChatwoot';
    this.estado = estado;
  }
}

/**
 * No se pudo confirmar si el mensaje al huésped salió o no. Por eso NO se reenvió ni se mandó
 * ningún otro mensaje encima: el equipo debe revisar la conversación.
 */
export class EnvioIncierto extends Error {
  readonly resultado: 'dudoso' | 'no-se';
  constructor(resultado: 'dudoso' | 'no-se', causa: unknown) {
    super(`No se pudo confirmar si el mensaje salió (${resultado})`, { cause: causa });
    this.name = 'EnvioIncierto';
    this.resultado = resultado;
  }
}
