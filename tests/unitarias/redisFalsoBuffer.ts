// Redis falso en memoria con lo que usa el buffer: listas, contador y multi.
const listas = new Map<string, string[]>();
const valores = new Map<string, string>();

export function limpiarBuffer() {
  listas.clear();
  valores.clear();
}

export const redisFalsoBuffer = {
  async rpush(clave: string, valor: string) {
    const l = listas.get(clave) ?? [];
    l.push(valor);
    listas.set(clave, l);
    return l.length;
  },
  async expire() {
    return 1;
  },
  async incr(clave: string) {
    const n = Number(valores.get(clave) ?? '0') + 1;
    valores.set(clave, String(n));
    return n;
  },
  async get(clave: string) {
    return valores.get(clave) ?? null;
  },
  multi() {
    const pasos: Array<() => unknown> = [];
    const cadena = {
      lrange(clave: string) {
        pasos.push(() => [...(listas.get(clave) ?? [])]);
        return cadena;
      },
      del(clave: string) {
        pasos.push(() => (listas.delete(clave) ? 1 : 0));
        return cadena;
      },
      async exec() {
        return pasos.map((p) => [null, p()]);
      },
    };
    return cadena;
  },
};
