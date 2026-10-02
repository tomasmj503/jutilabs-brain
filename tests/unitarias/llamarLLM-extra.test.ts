import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ClienteConfig, ContextoConversacion, HerramientaLLM } from '../../src/types/index.js';

const llamadas: Array<Record<string, unknown>> = [];

vi.mock('../../src/config/env.js', () => ({
  env: { OPENROUTER_BASE_URL: 'https://openrouter.example/api/v1' },
  secretoPorRef: () => 'clave-falsa',
}));
vi.mock('openai', () => ({
  default: class {
    chat = {
      completions: {
        create: async (cuerpo: Record<string, unknown>) => {
          llamadas.push(cuerpo);
          return { choices: [{ message: { content: 'Hola 🙏' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } };
        },
      },
    };
  },
}));

const { llamarLLM } = await import('../../src/llm/llamarLLM.js');

const cfg = (configExtra: Record<string, unknown>) => ({
  llmModelo: 'qwen/qwen3.8-flash', llmModeloRespaldo: null, llmTemperatura: 0.3, openrouterKeyRef: 'K', configExtra,
}) as unknown as ClienteConfig;
const conv = {} as ContextoConversacion;
const mensajes = [{ rol: 'system' as const, contenido: 's' }, { rol: 'user' as const, contenido: 'hola' }];

describe('llamarLLM — parámetros extra del cliente', () => {
  beforeEach(() => { llamadas.length = 0; });

  it('manda reasoning.enabled=false a OpenRouter cuando el cliente lo configura', async () => {
    await llamarLLM(mensajes, [], { cfg: cfg({ llmExtra: { reasoning: { enabled: false } } }), conv });
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]?.reasoning).toEqual({ enabled: false });
    expect(llamadas[0]?.model).toBe('qwen/qwen3.8-flash');
    expect(llamadas[0]?.max_tokens).toBe(500);
  });
  it('manda el objeto provider (orden de proveedores) tal cual a OpenRouter', async () => {
    const provider = { sort: 'latency', data_collection: 'deny' };
    await llamarLLM(mensajes, [], { cfg: cfg({ llmExtra: { reasoning: { enabled: false }, provider } }), conv });
    expect(llamadas[0]?.provider).toEqual(provider);
    expect(llamadas[0]?.reasoning).toEqual({ enabled: false });
  });
  it('sin configuración no manda nada extra', async () => {
    await llamarLLM(mensajes, [], { cfg: cfg({}), conv });
    expect(llamadas[0]).not.toHaveProperty('reasoning');
  });
  it('la configuración del cliente no puede pisar el modelo ni los mensajes', async () => {
    await llamarLLM(mensajes, [], { cfg: cfg({ llmExtra: { model: 'otro', messages: [], reasoning: { enabled: false } } }), conv });
    expect(llamadas[0]?.model).toBe('qwen/qwen3.8-flash');
    expect((llamadas[0]?.messages as unknown[]).length).toBe(2);
  });

  describe('herramientas de acción (soloTrasConsultar)', () => {
    const consulta: HerramientaLLM = { nombre: 'consultar_x', descripcion: 'd', parametros: { type: 'object', properties: {} }, ejecutar: async () => ({}) };
    const accion: HerramientaLLM = { ...consulta, nombre: 'pasar_a_persona', soloTrasConsultar: true };
    const nombres = (i: number) => ((llamadas[i]?.tools as Array<{ function: { name: string } }>) ?? []).map((t) => t.function.name);

    it('en la ronda obligatoria solo van las de consulta', async () => {
      await llamarLLM(mensajes, [consulta, accion], { cfg: cfg({}), conv });
      expect(nombres(0)).toEqual(['consultar_x']);
      expect(llamadas[0]?.tool_choice).toBe('required');
    });
    it('sin ronda obligatoria (ej. saludo) van todas', async () => {
      await llamarLLM(mensajes, [consulta, accion], { cfg: cfg({}), conv }, { forzarHerramienta: false });
      expect(nombres(0)).toEqual(['consultar_x', 'pasar_a_persona']);
      expect(llamadas[0]?.tool_choice).toBe('auto');
    });
    it('si TODAS son de acción, se ofrecen igual (no se deja la ronda sin herramientas)', async () => {
      await llamarLLM(mensajes, [accion], { cfg: cfg({}), conv });
      expect(nombres(0)).toEqual(['pasar_a_persona']);
    });
  });
});
