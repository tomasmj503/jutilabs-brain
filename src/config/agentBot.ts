import type { ClienteConfig } from '../types/index.js';

/**
 * ¿Este cliente ya opera con el Agent Bot de Chatwoot? Lo decide chatwootBotTokenRef: con él, el bot escribe con el token
 * del Agent Bot, se reconoce por sender.type "agent_bot" y solo atiende conversaciones en "pending". Sin él, el cliente
 * sigue exactamente como antes (token de usuario, bot reconocido por /api/v1/profile, sin regla "pending").
 */
export const modoAgentBot = (cfg: Pick<ClienteConfig, 'chatwootBotTokenRef'>): boolean => Boolean(cfg.chatwootBotTokenRef);
