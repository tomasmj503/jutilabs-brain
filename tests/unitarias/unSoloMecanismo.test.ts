import { describe, it, expect, vi, beforeEach } from 'vitest';

// #10 / V-17 (UNI-NOSE): un solo mecanismo de escalamiento. Las herramientas ya no piden «[[NO_SE]]» (contradecía al
// prompt) y una respuesta con texto + marca ENVÍA el texto y avisa al equipo (sin pausar) en vez de descartarlo.
const alertar = vi.fn();
const pausarBot = vi.fn();
const enviarMensaje = vi.fn(async () => 99);
const llm = vi.fn();
const faqEnBase: { faq: unknown[]; politicas: unknown[] } = { faq: [], politicas: [] };

vi.mock('../../src/config/env.js', () => ({ env: {}, secretoPorRef: () => 'x' }));
vi.mock('../../src/db/redis.js', () => ({ redis: { set: async () => 'OK' } }));
vi.mock('../../src/db/supabase.js', () => ({
  supabase: {
    from: (t: string) => {
      const c = { eq: () => c, then: (ok: (r: unknown) => unknown) => ok({ data: t === 'faq' ? faqEnBase.faq : faqEnBase.politicas, error: null }) };
      return { select: () => c };
    },
  },
}));
vi.mock('../../src/salida/alertaEquipo.js', () => ({
  alertarAlEquipo: alertar, conUnReintento: async (_p: string, _c: number, f: () => Promise<void>) => { await f(); return true; },
}));
vi.mock('../../src/conversacion/avisoPendiente.js', () => ({ registrarAvisoPendiente: vi.fn() }));
vi.mock('../../src/conversacion/estado.js', () => ({ pausarBot, estaPausado: async () => false, guardarIdioma: vi.fn() }));
vi.mock('../../src/conversacion/almacen.js', () => ({
  obtenerContexto: async () => ({ id: 'conv1', idioma: 'es', estadoBot: 'activo', chatwootConversationId: 7, ultimosMensajes: [] }),
  guardarMensaje: async () => undefined,
}));
vi.mock('../../src/conversacion/topeDiario.js', () => ({ llegoAlTope: async () => false }));
vi.mock('../../src/llm/conReintento.js', () => ({ llamarLLMConReintento: llm }));
vi.mock('../../src/salida/chatwoot.js', () => ({ enviarMensaje, enviarNotaPrivada: vi.fn(), marcarAbierta: vi.fn() }));
vi.mock('../../src/salida/avisoEquipo.js', () => ({ avisarAlCelular: vi.fn() }));

const { atenderTurno } = await import('../../src/ingesta/atenderTurno.js');
const { consultarFaq } = await import('../../src/llm/herramientas/consultarFaq.js');
const { generarLinkReserva } = await import('../../src/llm/herramientas/generarLinkReserva.js');

const cfg = {
  id: 'c1', idiomas: ['es', 'en'], idiomaDefault: 'es', temasQueEscalan: [], configExtra: {}, nombreBot: 'Max',
  promptBase: '', zonaHoraria: 'America/Bogota', limiteMensajesDiaConversacion: 40, linkReservaBase: null,
} as never;
const turno = (texto: string) => ({
  clienteId: 'c1', chatwootConversationId: 7, textoAgrupado: texto,
  mensajes: [{ clienteId: 'c1', chatwootAccountId: 1, chatwootConversationId: 7, chatwootContactId: 5, chatwootMessageId: 1, canal: 'whatsapp', telefono: '57300', contenido: texto, tipo: 'texto', recibidoAt: 'x' }],
}) as never;
const respuesta = (extra: object) => ({
  texto: '', modelo: 'm', tokensEntrada: 1, tokensSalida: 1, latenciaMs: 1, herramientasUsadas: [], proveedores: [], noSeElDato: false, ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  alertar.mockResolvedValue({ nota: true, celular: 'enviado', avisado: true });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('texto + marca [[NO_SE]]', () => {
  it('el texto SE ENVÍA (no se descarta), se avisa al equipo y NO se pausa', async () => {
    llm.mockResolvedValue(respuesta({ texto: 'La clase suelta cuesta 66.600. Lo del descuento por grupo no lo tengo.', noSeElDato: true }));
    await atenderTurno(cfg, turno('¿cuánto la clase y hay descuento por grupo?'));
    expect(enviarMensaje).toHaveBeenCalledWith(cfg, 7, expect.stringContaining('66.600'));
    expect(enviarMensaje).toHaveBeenCalledTimes(1);
    expect(alertar).toHaveBeenCalledTimes(1);
    expect(pausarBot).not.toHaveBeenCalled();
  });

  it('marca SIN texto: sigue igual (aviso fijo al huésped, aviso al equipo y pausa)', async () => {
    llm.mockResolvedValue(respuesta({ texto: '', noSeElDato: true }));
    await atenderTurno(cfg, turno('¿tienen servicio de lavandería a domicilio?'));
    expect(enviarMensaje).toHaveBeenCalledTimes(1);
    expect(pausarBot).toHaveBeenCalledWith(cfg, 7, 'no_se_el_dato');
  });

  it('respuesta normal sin marca: no avisa nada', async () => {
    llm.mockResolvedValue(respuesta({ texto: 'El check-in es desde las 2 pm.' }));
    await atenderTurno(cfg, turno('¿hora de check-in?'));
    expect(alertar).not.toHaveBeenCalled();
  });
});

describe('las herramientas ya no piden escribir [[NO_SE]]', () => {
  it('consultar_faq sin resultados: no menciona la marca', async () => {
    faqEnBase.faq = []; faqEnBase.politicas = [];
    const r = await consultarFaq.ejecutar({ consulta: 'lavandería' }, { cfg, conv: {} as never });
    expect(JSON.stringify(r)).not.toContain('[[NO_SE]]');
  });
  it('consultar_faq con resultados: la instrucción no manda a «pasar a una persona (escribe [[NO_SE]])»', async () => {
    faqEnBase.faq = [{ categoria: 'check', pregunta_es: '¿Hora de check-in?', respuesta_es: 'Desde las 2 pm.', palabras_clave: ['checkin'] }];
    faqEnBase.politicas = [];
    const r = await consultarFaq.ejecutar({ consulta: 'hora checkin check-in' }, { cfg, conv: {} as never });
    expect(JSON.stringify(r)).not.toContain('[[NO_SE]]');
  });
  it('generar_link_reserva sin link configurado: no menciona la marca', async () => {
    const r = await generarLinkReserva.ejecutar({}, { cfg, conv: {} as never });
    expect(JSON.stringify(r)).not.toContain('[[NO_SE]]');
  });
});
