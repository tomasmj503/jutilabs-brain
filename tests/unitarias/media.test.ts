import { describe, it, expect, vi, beforeEach } from 'vitest';
import { leerAviso, tipoDeAdjuntos } from '../../src/ingesta/aviso.js';
import { reglaMedia } from '../../src/router/reglas/media.js';
import { rutear } from '../../src/router/index.js';
import { descripcionMedia, debeAvisarMedia } from '../../src/ingesta/avisoMedia.js';
import { limpiar, redisFalso } from './redisFalso.js';

vi.mock('../../src/db/redis.js', async () => ({ redis: (await import('./redisFalso.js')).redisFalso }));
vi.spyOn(console, 'log').mockImplementation(() => undefined);

const base = {
  event: 'message_created', message_type: 'incoming', id: 600, content: '',
  sender: { id: 7, type: 'contact' }, conversation: { id: 42 }, account: { id: 1 },
};
const turno = (...msgs: Array<{ contenido: string; tipo: string }>) =>
  ({ mensajes: msgs, textoAgrupado: msgs.map((m) => m.contenido).filter(Boolean).join('\n') }) as never;
const ctx = (estadoBot: string) => ({ estadoBot }) as never;
const cfg = { temasQueEscalan: ['india'] } as never;

describe('leerAviso: adjuntos', () => {
  it('lee el tipo de un audio sin texto', () => {
    expect(leerAviso({ ...base, attachments: [{ id: 1, file_type: 'audio' }] })).toMatchObject({ contenido: '', adjuntos: ['audio'] });
  });
  it('lee ubicación e imagen', () => {
    expect(leerAviso({ ...base, attachments: [{ file_type: 'location' }, { file_type: 'image' }] }).adjuntos).toEqual(['location', 'image']);
  });
  it('un adjunto sin tipo cuenta como otro (no se pierde)', () => {
    expect(leerAviso({ ...base, attachments: [{ id: 1 }] }).adjuntos).toEqual(['otro']);
  });
  it('sin adjuntos, o si attachments no es lista, queda vacío', () => {
    expect(leerAviso(base).adjuntos).toEqual([]);
    expect(leerAviso({ ...base, attachments: 'x' }).adjuntos).toEqual([]);
  });
});

describe('tipoDeAdjuntos', () => {
  it('traduce los tipos de Chatwoot', () => {
    expect(tipoDeAdjuntos(['audio'])).toBe('audio');
    expect(tipoDeAdjuntos(['image'])).toBe('imagen');
    expect(tipoDeAdjuntos(['video'])).toBe('video');
    expect(tipoDeAdjuntos(['file'])).toBe('documento');
    expect(tipoDeAdjuntos(['location'])).toBe('ubicacion');
  });
  it('lo desconocido (o "constructor") es otro', () => {
    expect(tipoDeAdjuntos(['contact'])).toBe('otro');
    expect(tipoDeAdjuntos(['constructor'])).toBe('otro');
    expect(tipoDeAdjuntos([])).toBe('otro');
  });
});

describe('reglaMedia', () => {
  it('solo audio → decisión media', async () => {
    expect(await reglaMedia.evaluar(turno({ contenido: '', tipo: 'audio' }), ctx('activo'), cfg)).toEqual({ tipo: 'media', tipos: ['audio'] });
  });
  it('audio + imagen → lista ambos', async () => {
    const d = await reglaMedia.evaluar(turno({ contenido: '', tipo: 'audio' }, { contenido: '', tipo: 'imagen' }), ctx('activo'), cfg);
    expect(d).toEqual({ tipo: 'media', tipos: ['audio', 'imagen'] });
  });
  it('audio + texto en el mismo turno → no actúa (decide el texto)', async () => {
    expect(await reglaMedia.evaluar(turno({ contenido: '', tipo: 'audio' }, { contenido: 'hola', tipo: 'texto' }), ctx('activo'), cfg)).toBeNull();
  });
  it('solo texto → no actúa', async () => {
    expect(await reglaMedia.evaluar(turno({ contenido: 'hola', tipo: 'texto' }), ctx('activo'), cfg)).toBeNull();
  });
});

describe('rutear con media', () => {
  it('audio con el bot activo → media', async () => {
    expect(await rutear(turno({ contenido: '', tipo: 'audio' }), ctx('activo'), cfg)).toEqual({ tipo: 'media', tipos: ['audio'] });
  });
  it('audio con el bot pausado → ignorar (pausado va primero)', async () => {
    expect(await rutear(turno({ contenido: '', tipo: 'audio' }), ctx('pausado'), cfg)).toEqual({ tipo: 'ignorar', motivo: 'bot_pausado' });
  });
  it('texto normal sigue yendo al modelo', async () => {
    expect(await rutear(turno({ contenido: 'precio de yoga', tipo: 'texto' }), ctx('activo'), cfg)).toEqual({ tipo: 'llm' });
  });
});

describe('avisoMedia', () => {
  beforeEach(() => limpiar());
  it('avisa la primera vez y no la segunda dentro de la ventana, por conversación', async () => {
    expect(await debeAvisarMedia('c1')).toBe(true);
    expect(await debeAvisarMedia('c1')).toBe(false);
    expect(await debeAvisarMedia('c2')).toBe(true);
    expect(redisFalso).toBeDefined();
  });
  it('describe los tipos en español natural', () => {
    expect(descripcionMedia(['audio'])).toBe('un audio');
    expect(descripcionMedia(['audio', 'audio'])).toBe('un audio');
    expect(descripcionMedia(['audio', 'imagen'])).toBe('un audio y una imagen');
    expect(descripcionMedia(['audio', 'imagen', 'ubicacion'])).toBe('un audio, una imagen y una ubicación');
    expect(descripcionMedia([])).toBe('un archivo');
  });
});
