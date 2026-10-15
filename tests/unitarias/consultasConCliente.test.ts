import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * PC-22 / .clinerules: TODA consulta a una tabla de negocio filtra por cliente_id. El cerebro usa service role
 * (RLS no aplica), así que el único freno contra operar sobre datos de otro cliente es este filtro en el código.
 * Esta prueba recorre src/ y revisa cada `supabase.from('tabla')…` (la cadena completa, incluso en varias líneas).
 * `clientes` se exceptúa: se busca por su propia llave (slug, id o chatwoot_account_id).
 */
const RAIZ = join(import.meta.dirname, '../../src');

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const ruta = join(dir, n);
    return statSync(ruta).isDirectory() ? archivos(ruta) : ruta.endsWith('.ts') ? [ruta] : [];
  });
}

/** Texto de la cadena de llamadas que empieza en `.from('x')`: .a(...).b(...) incluso con saltos de línea. */
function cadena(src: string, desde: number): string {
  let i = desde;
  let fin = desde;
  for (;;) {
    const m = /^\s*\.\s*[A-Za-z_]\w*\s*\(/.exec(src.slice(i));
    if (!m) break;
    let prof = 1;
    let j = i + m[0].length;
    while (j < src.length && prof > 0) {
      if (src[j] === '(') prof++;
      else if (src[j] === ')') prof--;
      j++;
    }
    fin = j;
    i = j;
  }
  return src.slice(desde, fin);
}

describe('toda consulta a Supabase filtra por cliente_id', () => {
  const hallazgos: string[] = [];
  let revisadas = 0;
  for (const archivo of archivos(RAIZ)) {
    const src = readFileSync(archivo, 'utf8');
    for (const m of src.matchAll(/\.from\(\s*'([a-z_]+)'\s*\)/g)) {
      const tabla = m[1] as string;
      if (tabla === 'clientes') continue;
      revisadas++;
      const texto = cadena(src, (m.index ?? 0) + m[0].length);
      if (!/cliente_id/.test(texto)) {
        const linea = src.slice(0, m.index).split('\n').length;
        hallazgos.push(`${archivo.replace(RAIZ, 'src')}:${linea} → from('${tabla}') sin cliente_id`);
      }
    }
  }

  it('encontró consultas que revisar (la prueba no está vacía)', () => {
    expect(revisadas).toBeGreaterThan(8);
  });

  it('ninguna consulta de negocio queda sin filtro por cliente', () => {
    expect(hallazgos).toEqual([]);
  });
});
