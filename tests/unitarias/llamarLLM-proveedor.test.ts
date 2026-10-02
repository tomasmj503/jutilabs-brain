import { describe, it, expect, beforeEach } from 'vitest';
import { vi } from 'vitest';
import type { ClienteConfig, ContextoConversacion, HerramientaLLM } from '../../src/types/index.js';

type Respuesta = Record<string, unknown>;
const respuestas: Respuesta[] = [];

vi.mock('../../src/config/env.js', () => ({
  env: { OPENROUTER_BASE_URL: 'https://openrouter.example/api/v1' },
  secretoPorRef: () => 'clave-falsa',
}));
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: async () => respuestas.shift() } };
  },
}));

const { llamarLLM } = await import('../../src/llm/llamarLLM.js');

const cfg = { llmModelo: 'deepseek/deepseek-v4.1-flash', llmModeloRespaldo: null, llmTemperatura: 0.3, openrouterKeyRef: 'K', configExtra: {} } as unknown as ClienteConfig;
const conv = {} as ContextoConversacion;
const mensajes = [{ rol: 'system' as const, contenido: 's' }, { rol: 'user' as const, contenido: 'hola' }];
const usage = { prompt_tokens: 10, completion_tokens: 5 };
const consulta: HerramientaLLM = { nombre: 'consultar_x', descripcion: 'd', parametros: { type: 'object', properties: {} }, ejecutar: async () => ({ ok: true }) };
const pideHerramienta = (provider?: string): Respuesta => ({
  ...(provider ? { provider } : {}),
  choices: [{ message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'consultar_x', arguments: '{}' } }] } }],
  usage,
});
const respondeTexto = (provider?: string): Respuesta => ({ ...(provider ? { provider } : {}), choices: [{ message: { content: 'Hola 🙏' } }], usage });

describe('llamarLLM — proveedor que respondió', () => {
  beforeEach(() => { respuestas.length = 0; });

  it('guarda el proveedor que respondió (campo "provider" de OpenRouter)', async () => {
    respuestas.push(respondeTexto('DeepInfra'));
    const r = await llamarLLM(mensajes, [], { cfg, conv });
    expect(r.proveedores).toEqual(['DeepInfra']);
  });
  it('con varias vueltas al modelo guarda uno por vuelta, en orden', async () => {
    respuestas.push(pideHerramienta('DeepInfra'), respondeTexto('Novita'));
    const r = await llamarLLM(mensajes, [consulta], { cfg, conv });
    expect(r.proveedores).toEqual(['DeepInfra', 'Novita']);
  });
  it('si la respuesta no trae proveedor, anota "desconocido" (no se pierde la cuenta de vueltas)', async () => {
    respuestas.push(respondeTexto());
    const r = await llamarLLM(mensajes, [], { cfg, conv });
    expect(r.proveedores).toEqual(['desconocido']);
  });
});
