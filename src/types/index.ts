/**
 * CONTRATOS de jutilabs-brain.
 * Los define Claude (arquitectura). iCline no los modifica sin avisar.
 * Reflejan el esquema de supabase/migrations/0001_esquema_inicial.sql.
 */

export type Canal = 'whatsapp' | 'web';
export type Idioma = 'es' | 'en';
export type EstadoBot = 'activo' | 'pausado';
export type RolMensaje = 'huesped' | 'bot' | 'agente' | 'sistema';
export type TipoMensaje = 'texto' | 'audio' | 'imagen' | 'video' | 'documento' | 'ubicacion' | 'otro';

export type MotivoEscalamiento =
  | 'pidio_humano'
  | 'fuera_de_alcance'
  | 'media_no_soportado'
  | 'no_se_el_dato'
  | 'formulario_completado'
  | 'error_interno'
  | 'limite_mensajes';

// ---------- Configuración por cliente (tabla clientes) ----------

export interface ContactoEscalamiento {
  nombre: string;
  whatsapp: string; // E.164 sin '+', ej. 573001234567
  rol: string;
}

export interface ClienteConfig {
  id: string;
  slug: string; // 'mandala' | 'pruebas' | ...
  nombre: string;
  activo: boolean;
  botActivo: boolean; // kill-switch
  chatwootAccountId: number;
  chatwootTokenRef: string; // nombre de la variable de entorno
  idiomas: Idioma[];
  idiomaDefault: Idioma;
  zonaHoraria: string;
  nombreBot: string;
  promptBase: string;
  temasEnAlcance: string[];
  temasQueEscalan: string[];
  contactosEscalamiento: ContactoEscalamiento[];
  llmModelo: string;
  llmModeloRespaldo: string | null;
  llmTemperatura: number;
  openrouterKeyRef: string; // nombre de la variable de entorno, NO la clave
  limiteMensajesDiaConversacion: number;
  reactivacionHoras: number;
  linkReservaBase: string | null; // motor FDM con hostelId, sin fechas
  configExtra: Record<string, unknown>;
}

// ---------- Entrada ----------

export interface MensajeEntrante {
  clienteId: string;
  chatwootAccountId: number;
  chatwootConversationId: number;
  chatwootContactId: number;
  chatwootMessageId: number;
  canal: Canal;
  telefono: string | null;
  contenido: string;
  tipo: TipoMensaje;
  recibidoAt: string; // ISO
}

/** Varios MensajeEntrante agrupados por el buffer (~8 s) en un solo turno. */
export interface TurnoEntrante {
  clienteId: string;
  chatwootConversationId: number;
  mensajes: MensajeEntrante[];
  textoAgrupado: string;
}

// ---------- Estado de conversación (tabla conversaciones) ----------

export interface EstadoFormulario {
  formularioId: string;
  intencion: string;
  paso: number;
  datos: Record<string, string>;
}

export interface ContextoConversacion {
  id: string; // uuid interno
  clienteId: string;
  chatwootConversationId: number;
  canal: Canal;
  idioma: Idioma;
  pais: string | null;
  estadoBot: EstadoBot;
  formularioActivo: EstadoFormulario | null;
  mensajesSalientesHoy: number;
  ultimosMensajes: Array<{ rol: RolMensaje; contenido: string }>; // ventana corta para el LLM
}

// ---------- Router (sin LLM) ----------

export type DecisionRouter =
  | { tipo: 'ignorar'; motivo: string } // bot pausado, mensaje de agente, etc.
  | { tipo: 'escalar'; motivo: MotivoEscalamiento; mensajeAlHuesped: string | null }
  | { tipo: 'formulario'; estado: EstadoFormulario }
  | { tipo: 'llm' };

export interface ReglaRouter {
  nombre: string;
  evaluar(turno: TurnoEntrante, ctx: ContextoConversacion, cfg: ClienteConfig): Promise<DecisionRouter | null>;
}

// ---------- Formularios (tabla formularios) ----------

export interface CampoFormulario {
  clave: string;
  pregunta: Record<Idioma, string>;
  tipo: 'texto' | 'numero' | 'fecha' | 'telefono' | 'email' | 'si_no' | 'opcion';
  obligatorio: boolean;
  opciones?: string[];
}

export interface FormularioDef {
  id: string;
  clienteId: string;
  intencion: string;
  nombre: string;
  disparadores: string[]; // palabras/frases que lo activan (router)
  mensajeIntro: Record<Idioma, string>;
  campos: CampoFormulario[];
  mensajeCierre: Record<Idioma, string>;
  destinatario: string; // whatsapp del contacto que recibe el lead
  prioridad: number;
}

export type ResultadoFormulario =
  | { tipo: 'pregunta'; texto: string; estado: EstadoFormulario }
  | { tipo: 'completado'; leadId: string; texto: string };

// ---------- LLM ----------

export interface HerramientaLLM<TArgs = Record<string, unknown>, TResultado = unknown> {
  nombre: string;
  descripcion: string;
  parametros: Record<string, unknown>; // JSON Schema
  ejecutar(args: TArgs, ctx: { cfg: ClienteConfig; conv: ContextoConversacion }): Promise<TResultado>;
}

export interface RespuestaLLM {
  texto: string;
  modelo: string;
  tokensEntrada: number;
  tokensSalida: number;
  latenciaMs: number;
  herramientasUsadas: string[];
  /** El LLM indicó que no tiene el dato → el código decide escalar. */
  noSeElDato: boolean;
}

// ---------- Salida ----------

export interface RespuestaBot {
  clienteId: string;
  chatwootConversationId: number;
  texto: string; // UN solo mensaje
  idioma: Idioma;
  origen: 'router' | 'formulario' | 'llm' | 'escalamiento';
  metricas: Partial<RespuestaLLM>;
}
