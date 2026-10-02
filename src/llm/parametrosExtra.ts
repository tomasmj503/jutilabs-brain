import type { ClienteConfig } from '../types/index.js';

/** Campos que el cerebro maneja por su cuenta: la configuración del cliente nunca puede pisarlos. */
const RESERVADOS = new Set(['model', 'messages', 'tools', 'tool_choice', 'stream']);

/**
 * Parámetros extra para la llamada al modelo, por cliente (Supabase: clientes.config_extra → "llmExtra").
 * Ejemplo: {"reasoning": {"enabled": false}} apaga el razonamiento en OpenRouter. Hace falta con modelos que piensan por
 * defecto (ej. Qwen 3.8 Flash): en ese modo el proveedor rechaza tool_choice "required", y el cerebro lo usa en cada mensaje.
 * Solo se aceptan objetos planos; cualquier otra cosa se ignora. Los campos reservados se descartan.
 */
export function parametrosExtra(cfg: Pick<ClienteConfig, 'configExtra'>): Record<string, unknown> {
  const crudo = cfg.configExtra.llmExtra;
  if (typeof crudo !== 'object' || crudo === null || Array.isArray(crudo)) return {};
  return Object.fromEntries(Object.entries(crudo).filter(([k]) => !RESERVADOS.has(k)));
}
