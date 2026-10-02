import { describe, it, expect, vi, beforeEach } from 'vitest';

const guardarMensajeMock = vi.fn().mockResolvedValue(undefined);
const obtenerContextoMock = vi.fn();
const enviarMensajeMock = vi.fn().mockResolvedValue(999);
const enviarNotaPrivadaMock = vi.fn().mockResolvedValue(undefined);
const avisarEquipoYPausarMock = vi.fn().mockResolvedValue(undefined);
const llamarLLMMock = vi.fn();
const ruteoMock = vi.fn();

vi.mock('../../src/conversacion/almacen.js', () => ({ guardarMensaje: guardarMensajeMock, obtenerContexto: obtenerContextoMock }));
vi.mock('../../src/salida/chatwoot.js', () => ({ enviarMensaje: enviarMensajeMock, enviarNotaPrivada: enviarNotaPrivadaMock }));
vi.mock('../../src/salida/escalamiento.js', () => ({
  alertarEnvioIncierto: vi.fn(), responderYEscalar: vi.fn(), avisarEquipoYPausar: avisarEquipoYPausarMock,
}));
vi.mock('../../src/conversacion/estado.js', () => ({
  aplicarReactivacion: async (_cfg: unknown, conv: unknown) => conv,
  estaPausado: async () => false, guardarIdioma: vi.fn(), pausarBot: vi.fn(),
}));
vi.mock('../../src/llm/conReintento.js', () => ({ llamarLLMConReintento: llamarLLMMock }));
vi.mock('../../src/llm/prompt.js', () => ({ construirSystemPrompt: () => 'sistema' }));
vi.mock('../../src/router/index.js', () => ({ rutear: ruteoMock }));
vi.mock('../../src/router/texto.js', async (orig) => ({
  ...(await orig<object>()), detectarIdioma: () => 'es', esSoloSaludo: () => false,
}));
vi.mock('../../src/ingesta/textosFijos.js', async (orig) => ({
  ...(await orig<object>()), textoFijo: () => 'NO_ENTENDI_FIJO',
}));
vi.mock('../../src/config/env.js', () => ({ env: {}, secretoPorRef: () => 'x' }));
vi.mock('../../src/db/supabase.js', () => ({ supabase: {} }));
vi.mock('../../src/conversacion/topeDiario.js', () => ({ llegoAlTope: async () => false }));

const { atenderTurno } = await import('../../src/ingesta/atenderTurno.js');

const cfg = { id: 'c1', idiomaDefault: 'es', idiomas: ['es', 'en'], configExtra: {} } as never;
const turnoCon = (textoAgrupado: string) => ({
  clienteId: 'c1', chatwootConversationId: 1, textoAgrupado,
  mensajes: [{ clienteId: 'c1', chatwootAccountId: 1, chatwootConversationId: 1, chatwootContactId: 1, chatwootMessageId: 500, canal: 'whatsapp', telefono: '573000000000', contenido: textoAgrupado, tipo: 'texto', recibidoAt: 'x' }],
}) as never;
const convCon = (ultimosMensajes: unknown[] = []) => ({
  id: 'conv1', clienteId: 'c1', chatwootConversationId: 1, canal: 'whatsapp', idioma: 'es', pais: null,
  estadoBot: 'activo', formularioActivo: null, mensajesSalientesHoy: 0, ultimosMensajes,
});
const respuestaDelModelo = (texto: string, herramientasUsadas: string[] = ['consultar_faq']) => ({
  texto, noSeElDato: false, herramientasUsadas, modelo: 'm', tokensEntrada: 1, tokensSalida: 1, latenciaMs: 1,
});

describe('atenderTurno: red de seguridad para la promesa sin aviso', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    obtenerContextoMock.mockResolvedValue(convCon());
    ruteoMock.mockResolvedValue({ tipo: 'responder' });
  });

  it('el modelo promete "paso tu consulta" sin llamar a la herramienta: la respuesta sale Y se avisa al equipo', async () => {
    const t = 'Los descuentos los maneja el equipo, así que paso tu consulta para que te propongan una opción 🙏';
    llamarLLMMock.mockResolvedValue(respuestaDelModelo(t));
    await atenderTurno(cfg, turnoCon('¿hacen descuento por un mes?'));
    expect(enviarMensajeMock).toHaveBeenCalledWith(cfg, 1, t);
    expect(avisarEquipoYPausarMock).toHaveBeenCalledTimes(1);
    expect(avisarEquipoYPausarMock).toHaveBeenCalledWith(cfg, 1, 'fuera_de_alcance', '¿hacen descuento por un mes?');
  });

  it('respuesta normal sobre el café ("el equipo te recibe en recepción"): NO avisa', async () => {
    const t = 'Al llegar, el equipo te recibe en recepción y te cuenta del café ☕';
    llamarLLMMock.mockResolvedValue(respuestaDelModelo(t));
    await atenderTurno(cfg, turnoCon('¿dónde queda el café?'));
    expect(enviarMensajeMock).toHaveBeenCalledWith(cfg, 1, t);
    expect(avisarEquipoYPausarMock).not.toHaveBeenCalled();
  });

  it('una oferta ("¿quieres que el equipo te confirme?") NO avisa: el huésped todavía no pidió nada', async () => {
    llamarLLMMock.mockResolvedValue(respuestaDelModelo('¿Te gustaría que el equipo te confirme la tarifa? Quedo atenta para pasar tu consulta 🙏'));
    await atenderTurno(cfg, turnoCon('¿hay tarifa para huéspedes?'));
    expect(avisarEquipoYPausarMock).not.toHaveBeenCalled();
  });

  it('si el modelo SÍ llamó a pasar_a_persona y además lo promete en el texto: se avisa UNA sola vez', async () => {
    llamarLLMMock.mockResolvedValue(respuestaDelModelo('Paso tu consulta al equipo 🙏', ['consultar_faq', 'pasar_a_persona']));
    await atenderTurno(cfg, turnoCon('quiero un reembolso'));
    expect(avisarEquipoYPausarMock).toHaveBeenCalledTimes(1);
  });

  it('camino de repetición: sale el "no entendí" fijo y NO se avisa, porque el huésped nunca vio la promesa', async () => {
    const promesa = 'Paso tu consulta al equipo 🙏';
    obtenerContextoMock.mockResolvedValue(convCon([
      { rol: 'huesped', contenido: '¿hacen descuento?' },
      { rol: 'bot', contenido: promesa },
    ]));
    llamarLLMMock.mockResolvedValue(respuestaDelModelo(promesa));
    await atenderTurno(cfg, turnoCon('asdf'));
    expect(enviarMensajeMock).toHaveBeenCalledWith(cfg, 1, 'NO_ENTENDI_FIJO');
    expect(enviarMensajeMock).not.toHaveBeenCalledWith(cfg, 1, promesa);
    expect(avisarEquipoYPausarMock).not.toHaveBeenCalled();
  });
});

describe('atenderTurno: la red de seguridad deja huella en el log (para medirla en el piloto)', () => {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const lineasDeRed = () => logSpy.mock.calls.map((c: unknown[]) => String(c[0])).filter((l: string) => l.startsWith('RED DE SEGURIDAD'));

  beforeEach(() => {
    vi.clearAllMocks();
    obtenerContextoMock.mockResolvedValue(convCon());
    ruteoMock.mockResolvedValue({ tipo: 'responder' });
  });

  it('promesa sin herramienta: queda UNA línea RED DE SEGURIDAD con la conversación y el texto', async () => {
    llamarLLMMock.mockResolvedValue(respuestaDelModelo('Los descuentos los maneja el equipo, así que paso tu consulta 🙏'));
    await atenderTurno(cfg, turnoCon('¿hacen descuento por un mes?'));
    const lineas = lineasDeRed();
    expect(lineas).toHaveLength(1);
    expect(lineas[0]).toContain('conv=1');
    expect(lineas[0]).toContain('paso tu consulta');
  });

  it('si el modelo SÍ llamó a pasar_a_persona: la red no actuó, no deja línea', async () => {
    llamarLLMMock.mockResolvedValue(respuestaDelModelo('Paso tu consulta al equipo 🙏', ['consultar_faq', 'pasar_a_persona']));
    await atenderTurno(cfg, turnoCon('quiero un reembolso'));
    expect(avisarEquipoYPausarMock).toHaveBeenCalledTimes(1);
    expect(lineasDeRed()).toHaveLength(0);
  });

  it('respuesta normal y oferta: no avisa y no deja línea', async () => {
    llamarLLMMock.mockResolvedValue(respuestaDelModelo('¿Te gustaría que el equipo te confirme la tarifa? Quedo atenta para pasar tu consulta 🙏'));
    await atenderTurno(cfg, turnoCon('¿hay tarifa para huéspedes?'));
    expect(avisarEquipoYPausarMock).not.toHaveBeenCalled();
    expect(lineasDeRed()).toHaveLength(0);
  });
});
