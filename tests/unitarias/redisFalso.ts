// Redis falso en memoria para las pruebas: solo lo que usan dedup y candado.
export const almacen = new Map<string, string>();
export const llamadas: unknown[][] = [];

export const redisFalso = {
  async set(clave: string, valor: string, ...resto: unknown[]) {
    llamadas.push([clave, valor, ...resto]);
    if (resto.includes('NX') && almacen.has(clave)) return null;
    almacen.set(clave, valor);
    return 'OK';
  },
  async eval(_script: string, _n: number, clave: string, dueno: string) {
    if (almacen.get(clave) !== dueno) return 0;
    almacen.delete(clave);
    return 1;
  },
};

export function limpiar() {
  almacen.clear();
  llamadas.length = 0;
}
