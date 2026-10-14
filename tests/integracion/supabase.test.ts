import { describe, it, expect, beforeEach } from 'vitest';
import { crearSupabaseDePrueba, limpiarTablas } from './entorno.js';

const supabase = crearSupabaseDePrueba();

describe('supabase-js contra Postgres real (vía PostgREST)', () => {
  beforeEach(limpiarTablas);

  it('inserta y lee un cliente filtrando por cliente_id, y el duplicado da 23505', async () => {
    const alta = await supabase.from('clientes').insert({
      slug: 'a', nombre: 'A', chatwoot_token_ref: 'T', llm_modelo: 'm', openrouter_key_ref: 'K', chatwoot_account_id: 1,
    }).select('id').single();
    expect(alta.error).toBeNull();
    const id = (alta.data as { id: string }).id;

    const conv = { cliente_id: id, chatwoot_conversation_id: 7, canal: 'whatsapp' };
    expect((await supabase.from('conversaciones').insert(conv)).error).toBeNull();
    const duplicada = await supabase.from('conversaciones').insert(conv);
    expect(duplicada.error?.code).toBe('23505');

    const leida = await supabase.from('conversaciones').select('estado_bot').eq('cliente_id', id)
      .eq('chatwoot_conversation_id', 7).maybeSingle();
    expect((leida.data as { estado_bot: string }).estado_bot).toBe('activo');
  });
});
