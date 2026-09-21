import { describe, it, expect } from 'vitest';
import { textoFijo } from '../../src/ingesta/textosFijos.js';
import type { ClienteConfig } from '../../src/types/index.js';

const cfg = (extra: Record<string, unknown>) => ({ configExtra: extra }) as unknown as ClienteConfig;

describe('textoFijo', () => {
  it('usa el texto de Supabase si existe', () => {
    const c = cfg({ mensajeAcuse: { es: 'Texto propio' } });
    expect(textoFijo(c, 'mensajeAcuse', 'es')).toBe('Texto propio');
  });
  it('sin configuración usa el texto por defecto en español', () => {
    expect(textoFijo(cfg({}), 'mensajeNoEntendi', 'es')).toContain('No te entendí');
  });
  it('sin configuración usa el texto por defecto en inglés', () => {
    expect(textoFijo(cfg({}), 'mensajeAcuse', 'en')).toContain('still here');
  });
  it('ignora textos vacíos', () => {
    expect(textoFijo(cfg({ mensajeAcuse: { es: '  ' } }), 'mensajeAcuse', 'es')).toContain('Aquí sigo');
  });
});
