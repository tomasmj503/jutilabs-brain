/** Lee --extra: un objeto JSON que se suma a lo que la prueba manda al modelo (lo mismo que irá en clientes.config_extra → llmExtra). */
export function leerExtra(texto: string | undefined): Record<string, unknown> {
  if (texto === undefined) return {};
  let valor: unknown;
  try {
    valor = JSON.parse(texto);
  } catch {
    throw new Error('--extra no es JSON válido. Ejemplo: --extra \'{"provider":{"sort":"latency"}}\'');
  }
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) throw new Error('--extra debe ser un objeto JSON, por ejemplo {"provider":{"sort":"latency"}}');
  return valor as Record<string, unknown>;
}

/** El llmExtra que usa la prueba: el razonamiento según el modo + lo de --extra (si choca, gana --extra). */
export function armarLlmExtra(modo: 'apagado' | 'normal', extra: Record<string, unknown>): Record<string, unknown> | undefined {
  const lleno = { ...(modo === 'apagado' ? { reasoning: { enabled: false } } : {}), ...extra };
  return Object.keys(lleno).length === 0 ? undefined : lleno;
}
