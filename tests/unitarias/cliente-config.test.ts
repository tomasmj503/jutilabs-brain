import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const maybeSingle = vi.fn();
vi.mock('../../src/db/supabase.js', () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }) },
}));

const { cargarClientePorChatwootAccount } = await import('../../src/config/cliente.js');

const fila = (nombre: string) => ({
  id: 'c1', slug: 'm', nombre, activo: true, bot_activo: true, chatwoot_account_id: 1, chatwoot_token_ref: 'T',
  idiomas: ['es'], idioma_default: 'es', zona_horaria: 'America/Bogota', nombre_bot: 'Bot', prompt_base: 'x',
  temas_en_alcance: [], temas_que_escalan: [], contactos_escalamiento: {}, llm_modelo: 'm', llm_modelo_respaldo: null,
  llm_temperatura: '0.3', openrouter_key_ref: 'K', limite_mensajes_dia_conversacion: 10, reactivacion_horas: 5,
  link_reserva_base: null, config_extra: {}, tono: null, mensaje_escalamiento: null, mensaje_no_se_el_dato: null,
  limite_gasto_usd_dia: null,
});

describe('cargarClientePorChatwootAccount: si Supabase falla', () => {
  beforeEach(() => { vi.useFakeTimers(); maybeSingle.mockReset(); });
  afterEach(() => vi.useRealTimers());

  it('usa la última configuración conocida cuando la memoria ya venció y Supabase falla', async () => {
    maybeSingle.mockResolvedValueOnce({ data: fila('Mandala'), error: null });
    expect((await cargarClientePorChatwootAccount(11))?.nombre).toBe('Mandala');
    vi.advanceTimersByTime(61_000);
    maybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'red caída' } });
    expect((await cargarClientePorChatwootAccount(11))?.nombre).toBe('Mandala');
  });

  it('tras usar la última conocida, no golpea a Supabase en cada mensaje (espera 10 s)', async () => {
    maybeSingle.mockResolvedValueOnce({ data: fila('Mandala'), error: null });
    await cargarClientePorChatwootAccount(12);
    vi.advanceTimersByTime(61_000);
    maybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'red caída' } });
    await cargarClientePorChatwootAccount(12);
    await cargarClientePorChatwootAccount(12);
    expect(maybeSingle).toHaveBeenCalledTimes(2);
  });

  it('si nunca lo había visto y Supabase falla, sigue lanzando el error', async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'red caída' } });
    await expect(cargarClientePorChatwootAccount(13)).rejects.toThrow('Error leyendo cliente');
  });

  it('un cliente que no existe (sin error) sigue devolviendo null', async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    expect(await cargarClientePorChatwootAccount(14)).toBeNull();
  });
});
