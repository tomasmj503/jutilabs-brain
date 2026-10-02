import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ClienteConfig, ContextoConversacion, HerramientaLLM } from '../../src/types/index.js';

// Simulador de OpenRouter: cada llamada saca el siguiente paso de la lista (un Error se lanza, un objeto se devuelve).
type Paso = Error | Record<string, unknown>;
const pasos: Paso[] = [];
const llamadas: Array<{ model: unknown }> = [];

class APIConnectionError extends Error { status = undefined; constructor(m = 'Connection error.', public cause?: unknown) { super(m); } }
class APIConnectionTimeoutError extends APIConnectionError { constructor() { super('Request timed out.'); } }
class ErrorHttp extends Error { constructor(public status: number, m: string) { super(m); } }
const corte = () => new APIConnectionError('Connection error.', Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }));

vi.mock('../../src/config/env.js', () => ({ env: { OPENROUTER_BASE_URL: 'https://openrouter.example/api/v1' }, secretoPorRef: () => 'clave-falsa' }));
vi.mock('openai', () => ({
  default: class {
    chat = {
      completions: {
        create: async (cuerpo: { model: unknown }) => {
          llamadas.push({ model: cuerpo.model });
          const paso = pasos.shift();
          if (paso instanceof Error) throw paso;
          return paso;
        },
      },
    };
  },
}));

const { llamarLLM } = await import('../../src/llm/llamarLLM.js');

const cfg = (respaldo: string | null = null) => ({ llmModelo: 'principal', llmModeloRespaldo: respaldo, llmTemperatura: 0.3, openrouterKeyRef: 'K', configExtra: {} }) as unknown as ClienteConfig;
const conv = {} as ContextoConversacion;
const mensajes = [{ rol: 'system' as const, contenido: 's' }, { rol: 'user' as const, contenido: 'hola' }];
const bien = (texto = 'Hola 🙏'): Paso => ({ provider: 'Together', choices: [{ message: { content: texto } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
const pideHerramienta = (): Paso => ({ provider: 'Together', choices: [{ message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'consultar_x', arguments: '{}' } }] } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });

describe('llamarLLM — reintento de una vez ante un corte de conexión', () => {
  let log: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { pasos.length = 0; llamadas.length = 0; log = vi.spyOn(console, 'error').mockImplementation(() => undefined); });
  afterEach(() => log.mockRestore());
  const lineasDeReintento = () => log.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('LLM REINTENTO CONEXION'));

  it('corte de conexión y luego respuesta buena: termina bien con el mismo modelo, y deja una línea en el log', async () => {
    pasos.push(corte(), bien());
    const r = await llamarLLM(mensajes, [], { cfg: cfg('respaldo'), conv });
    expect(r.texto).toBe('Hola 🙏');
    expect(r.modelo).toBe('principal');
    expect(llamadas.map((l) => l.model)).toEqual(['principal', 'principal']);
    expect(r.proveedores).toEqual(['Together']);
    const lineas = lineasDeReintento();
    expect(lineas).toHaveLength(1);
    expect(lineas[0]).toContain('modelo=principal');
    expect(lineas[0]).toContain('ECONNRESET');
  });
  it('error HTTP 400: NO reintenta', async () => {
    pasos.push(new ErrorHttp(400, 'mala petición'));
    await expect(llamarLLM(mensajes, [], { cfg: cfg(), conv })).rejects.toThrow('mala petición');
    expect(llamadas).toHaveLength(1);
    expect(lineasDeReintento()).toHaveLength(0);
  });
  it('tiempo agotado (25 s): NO reintenta con el mismo modelo', async () => {
    pasos.push(new APIConnectionTimeoutError());
    await expect(llamarLLM(mensajes, [], { cfg: cfg(), conv })).rejects.toThrow('Request timed out.');
    expect(llamadas).toHaveLength(1);
    expect(lineasDeReintento()).toHaveLength(0);
  });
  it('dos cortes seguidos: reintenta UNA vez y luego pasa al respaldo', async () => {
    pasos.push(corte(), corte(), bien('desde el respaldo'));
    const r = await llamarLLM(mensajes, [], { cfg: cfg('respaldo'), conv });
    expect(llamadas.map((l) => l.model)).toEqual(['principal', 'principal', 'respaldo']);
    expect(r.texto).toBe('desde el respaldo');
    expect(lineasDeReintento()).toHaveLength(1);
  });
  it('dos cortes seguidos y sin respaldo: falla (no reintenta más de una vez)', async () => {
    pasos.push(corte(), corte());
    await expect(llamarLLM(mensajes, [], { cfg: cfg(), conv })).rejects.toThrow('Connection error.');
    expect(llamadas).toHaveLength(2);
  });
  it('el reintento es de la llamada, no del turno: las herramientas ya consultadas no se repiten', async () => {
    let consultas = 0;
    const consulta: HerramientaLLM = { nombre: 'consultar_x', descripcion: 'd', parametros: { type: 'object', properties: {} }, ejecutar: async () => { consultas++; return { ok: true }; } };
    pasos.push(pideHerramienta(), corte(), bien('con datos'));
    const r = await llamarLLM(mensajes, [consulta], { cfg: cfg(), conv });
    expect(r.texto).toBe('con datos');
    expect(consultas).toBe(1);
    expect(llamadas).toHaveLength(3);
  });
});
