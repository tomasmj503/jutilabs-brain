import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dominioPermitido, generarLinkReserva } from '../../src/llm/herramientas/generarLinkReserva.js';

// #1 / PC-16 (UNI-LINK): solo dominios de config_extra.dominios_permitidos. Falla cerrada.
const FDM = 'https://new-booking-staging.frontdeskmaster.com/MandalaYogaHostel?hostelId=123';
const cfg = (extra: Record<string, unknown>, base: string | null = FDM) =>
  ({ slug: 'm', zonaHoraria: 'America/Bogota', linkReservaBase: base, configExtra: extra }) as never;
const ejecutar = (c: never, args: Record<string, unknown> = {}) => generarLinkReserva.ejecutar(args, { cfg: c, conv: {} as never }) as Promise<Record<string, string>>;

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => undefined); });

describe('dominioPermitido', () => {
  const lista = ['new-booking-staging.frontdeskmaster.com'];
  it('host exacto en la lista y https → sí', () => {
    expect(dominioPermitido(FDM, lista)).toBe(true);
  });
  it('no distingue mayúsculas y tolera que la lista traiga esquema o ruta', () => {
    expect(dominioPermitido(FDM, ['https://NEW-booking-staging.frontdeskmaster.com/'])).toBe(true);
  });
  it.each([
    ['https://frontdeskmaster.com/x'], ['https://evil.com/?u=new-booking-staging.frontdeskmaster.com'],
    ['https://new-booking-staging.frontdeskmaster.com.evil.com/x'], ['https://sub.new-booking-staging.frontdeskmaster.com/x'],
    ['http://new-booking-staging.frontdeskmaster.com/x'], ['no es una url'], [''],
  ])('«%s» no', (base) => {
    expect(dominioPermitido(base, lista)).toBe(false);
  });
  it('sin lista, lista vacía o mal formada → no (falla cerrada)', () => {
    for (const l of [undefined, null, [], 'new-booking-staging.frontdeskmaster.com', [1, null, '']]) {
      expect(dominioPermitido(FDM, l)).toBe(false);
    }
  });
});

describe('generar_link_reserva', () => {
  const permitidos = { dominios_permitidos: ['new-booking-staging.frontdeskmaster.com'] };

  it('con el dominio en la lista entrega el link con los parámetros', async () => {
    const r = await ejecutar(cfg(permitidos), { noches: 2, huespedes: 2 });
    expect(r.link).toBe(`${FDM}&nights=2&guests=2`);
  });
  it('base en un dominio que NO está en la lista → error, sin link', async () => {
    const r = await ejecutar(cfg(permitidos, 'https://otro-motor.example.com/reservas'));
    expect(r.link).toBeUndefined();
    expect(r.error).toBeTruthy();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('BLOQUEADO'));
  });
  it('cliente SIN lista configurada → no hay link (falla cerrada)', async () => {
    const r = await ejecutar(cfg({}));
    expect(r.link).toBeUndefined();
    expect(r.error).toBeTruthy();
  });
  it('el mensaje de error no manda al modelo a escribir [[NO_SE]]', async () => {
    const r = await ejecutar(cfg({}));
    expect(JSON.stringify(r)).not.toContain('[[NO_SE]]');
  });
  it('sin link configurado sigue dando error (como antes)', async () => {
    const r = await ejecutar(cfg(permitidos, null));
    expect(r.error).toBeTruthy();
  });
});
