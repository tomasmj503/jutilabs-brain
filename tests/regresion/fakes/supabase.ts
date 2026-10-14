/**
 * Supabase en memoria para la regresión: solo lo que usa el cerebro (select/insert/update con eq, in, not,
 * gte, order, limit, maybeSingle, count). Respeta las llaves únicas (23505) y puede "caerse" entero.
 * No pretende ser Postgres: lo que necesita fidelidad real va en tests/integracion.
 */
type Fila = Record<string, unknown>;
type Resultado = { data: unknown; error: { message: string; code?: string } | null; count?: number | null };
type Filtro = (f: Fila) => boolean;

const UNICAS: Record<string, string[][]> = {
  conversaciones: [['cliente_id', 'chatwoot_conversation_id']],
  mensajes: [['cliente_id', 'chatwoot_message_id']],
};

export class BaseEnMemoria {
  tablas = new Map<string, Fila[]>();
  caida = false;
  /** Cuántas consultas recibió (sirve para afirmar "no se tocó la base"). */
  consultas = 0;
  private contador = 0;

  tabla(nombre: string): Fila[] {
    let t = this.tablas.get(nombre);
    if (!t) this.tablas.set(nombre, (t = []));
    return t;
  }
  nuevoId(prefijo: string): string {
    return `${prefijo}-${++this.contador}`;
  }
  reiniciar(): void {
    this.tablas.clear();
    this.caida = false;
    this.consultas = 0;
    this.contador = 0;
  }
  from(nombre: string): Consulta {
    return new Consulta(this, nombre);
  }
}

class Consulta implements PromiseLike<Resultado> {
  private op: 'select' | 'insert' | 'update' = 'select';
  private filtros: Filtro[] = [];
  private cambios: Fila | null = null;
  private orden: { col: string; asc: boolean } | null = null;
  private limite: number | null = null;
  private cabeza = false;
  private contar = false;
  private unico: 'maybe' | 'single' | null = null;

  constructor(private base: BaseEnMemoria, private nombre: string) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }): this {
    if (opts?.count) this.contar = true;
    if (opts?.head) this.cabeza = true;
    return this;
  }
  insert(f: Fila): this { this.op = 'insert'; this.cambios = f; return this; }
  update(f: Fila): this { this.op = 'update'; this.cambios = f; return this; }
  eq(col: string, v: unknown): this { this.filtros.push((f) => f[col] === v); return this; }
  gte(col: string, v: unknown): this { this.filtros.push((f) => String(f[col]) >= String(v)); return this; }
  lt(col: string, v: unknown): this { this.filtros.push((f) => String(f[col]) < String(v)); return this; }
  is(col: string, v: unknown): this { this.filtros.push((f) => (f[col] ?? null) === v); return this; }
  in(col: string, vs: unknown[]): this { this.filtros.push((f) => vs.includes(f[col])); return this; }
  not(col: string, operador: string, v: unknown): this {
    if (operador === 'in') {
      const lista = Array.isArray(v) ? v : String(v).replace(/^\(|\)$/g, '').split(',');
      this.filtros.push((f) => !lista.map(String).includes(String(f[col])));
    } else if (operador === 'is') {
      this.filtros.push((f) => (f[col] ?? null) !== v);
    }
    return this;
  }
  order(col: string, o?: { ascending?: boolean }): this { this.orden = { col, asc: o?.ascending ?? true }; return this; }
  limit(n: number): this { this.limite = n; return this; }
  maybeSingle(): this { this.unico = 'maybe'; return this; }
  single(): this { this.unico = 'single'; return this; }

  private ejecutar(): Resultado {
    this.base.consultas++;
    if (this.base.caida) return { data: null, error: { message: 'fetch failed (base caída)' } };
    const tabla = this.base.tabla(this.nombre);
    if (this.op === 'insert') {
      const fila: Fila = { id: this.base.nuevoId(this.nombre), created_at: new Date().toISOString(), ...this.cambios };
      for (const llave of UNICAS[this.nombre] ?? []) {
        if (llave.some((c) => fila[c] === null || fila[c] === undefined)) continue;
        if (tabla.some((t) => llave.every((c) => t[c] === fila[c]))) {
          return { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } };
        }
      }
      if (this.nombre === 'conversaciones') {
        fila.estado_bot ??= 'activo';
        fila.idioma ??= 'es';
        fila.pais ??= null;
      }
      tabla.push(fila);
      return { data: fila, error: null };
    }
    let filas = tabla.filter((f) => this.filtros.every((p) => p(f)));
    if (this.op === 'update') {
      for (const f of filas) Object.assign(f, this.cambios);
      return { data: filas, error: null };
    }
    if (this.orden) {
      const { col, asc } = this.orden;
      filas = [...filas].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1));
    }
    const total = filas.length;
    if (this.limite !== null) filas = filas.slice(0, this.limite);
    if (this.cabeza) return { data: null, error: null, count: total };
    if (this.unico) return { data: filas[0] ?? null, error: null, count: this.contar ? total : null };
    return { data: filas, error: null, count: this.contar ? total : null };
  }

  then<A = Resultado, B = never>(
    ok?: ((v: Resultado) => A | PromiseLike<A>) | null, no?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve().then(() => this.ejecutar()).then(ok, no);
  }
}

export const base = new BaseEnMemoria();
export const supabaseFalso = { from: (t: string) => base.from(t) };
