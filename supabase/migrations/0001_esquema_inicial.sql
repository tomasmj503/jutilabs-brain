-- ============================================================================
-- jutilabs-brain — esquema inicial (Supabase). Fuente: Notion §11.6.
-- Regla: TODA tabla lleva cliente_id. El brain usa service role y filtra en código;
-- RLS protege al tablero de KPIs (Vercel) y a cualquier acceso con JWT.
-- Correr en el SQL Editor del proyecto NUEVO de Supabase (aislado de proyectos personales).
-- ============================================================================

create extension if not exists pgcrypto;

-- updated_at automático
create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- ---------------------------------------------------------------- clientes
create table public.clientes (
  id                               uuid primary key default gen_random_uuid(),
  slug                             text not null unique,            -- 'mandala', 'pruebas'
  nombre                           text not null,
  activo                           boolean not null default true,
  bot_activo                       boolean not null default true,   -- kill-switch por cliente
  chatwoot_account_id              integer unique,
  chatwoot_token_ref               text not null,                   -- nombre de variable de entorno (no el token)
  idiomas                          text[] not null default '{es,en}',
  idioma_default                   text not null default 'es',
  zona_horaria                     text not null default 'America/Bogota',
  nombre_bot                       text not null default 'Asistente',
  prompt_base                      text,                            -- lo redacta Claude
  tono                             jsonb not null default '{}',     -- {"adjetivos":[...],"saludo_es":"...","saludo_en":"..."}
  temas_en_alcance                 text[] not null default '{}',
  temas_que_escalan                text[] not null default '{}',
  contactos_escalamiento           jsonb not null default '[]',     -- [{"nombre","whatsapp","rol"}]
  mensaje_escalamiento             jsonb not null default '{}',     -- {"es":"...","en":"..."}
  mensaje_no_se_el_dato            jsonb not null default '{}',
  llm_modelo                       text not null,
  llm_modelo_respaldo              text,
  llm_temperatura                  numeric(3,2) not null default 0.30,
  openrouter_key_ref               text not null,                   -- nombre de variable de entorno
  limite_mensajes_dia_conversacion integer not null default 40,
  limite_gasto_usd_dia             numeric(8,2),
  reactivacion_horas               integer not null default 5,
  link_reserva_base                text,                            -- motor FDM con hostelId, sin fechas
  config_extra                     jsonb not null default '{}',
  created_at                       timestamptz not null default now(),
  updated_at                       timestamptz not null default now()
);
create trigger trg_clientes_updated before update on public.clientes for each row execute function public.set_updated_at();

-- ------------------------------------------------------------ habitaciones
create table public.habitaciones (
  id                uuid primary key default gen_random_uuid(),
  cliente_id        uuid not null references public.clientes(id) on delete cascade,
  clave             text not null,                 -- 'shiva', 'krishna' (clave estable para el Sheet)
  nombre            text not null,
  tipo              text not null check (tipo in ('privada','compartida')),
  descripcion       text,
  capacidad         integer,
  incluye           text[] not null default '{}',
  ideal_para        text,
  respuesta_modelo  jsonb not null default '{}',   -- {"es":"...","en":"..."} del documento del cliente
  orden             integer not null default 0,
  activo            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (cliente_id, clave)
);
create trigger trg_habitaciones_updated before update on public.habitaciones for each row execute function public.set_updated_at();

-- --------------------------------------------------------------- productos
create table public.productos (
  id             uuid primary key default gen_random_uuid(),
  cliente_id     uuid not null references public.clientes(id) on delete cascade,
  clave          text not null,
  categoria      text not null check (categoria in ('clase','paquete','evento','tienda','servicio')),
  nombre         text not null,
  descripcion    text,
  precio         numeric(12,2),
  moneda         text not null default 'COP',
  unidad         text,                          -- 'por clase', '4 clases'
  vigencia_hasta date,
  activo         boolean not null default true, -- lo NO confirmado queda inactivo (regla §11.6)
  notas          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (cliente_id, clave)
);
create trigger trg_productos_updated before update on public.productos for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------ clases
create table public.clases (
  id                uuid primary key default gen_random_uuid(),
  cliente_id        uuid not null references public.clientes(id) on delete cascade,
  clave             text not null,
  nombre            text not null,
  dia_semana        smallint not null check (dia_semana between 0 and 6), -- 0=domingo
  hora              time not null,
  duracion_min      integer,
  frecuencia        text not null default 'semanal' check (frecuencia in ('semanal','quincenal','mensual')),
  descripcion       text,
  nivel             text default 'multinivel',
  respuesta_modelo  jsonb not null default '{}',
  activo            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (cliente_id, clave)
);
create trigger trg_clases_updated before update on public.clases for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------- eventos
create table public.eventos (
  id           uuid primary key default gen_random_uuid(),
  cliente_id   uuid not null references public.clientes(id) on delete cascade,
  nombre       text not null,
  fecha        date not null,
  hora         time,
  descripcion  text,
  precio       numeric(12,2),
  moneda       text not null default 'COP',
  link         text,
  activo       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index idx_eventos_cliente_fecha on public.eventos (cliente_id, fecha) where activo;
create trigger trg_eventos_updated before update on public.eventos for each row execute function public.set_updated_at();

-- --------------------------------------------------------------------- faq
create table public.faq (
  id              uuid primary key default gen_random_uuid(),
  cliente_id      uuid not null references public.clientes(id) on delete cascade,
  clave           text not null,
  categoria       text not null,
  pregunta_es     text not null,
  pregunta_en     text,
  respuesta_es    text not null,
  respuesta_en    text,
  palabras_clave  text[] not null default '{}',
  orden           integer not null default 0,
  activo          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (cliente_id, clave)
);
create index idx_faq_cliente_cat on public.faq (cliente_id, categoria) where activo;
create trigger trg_faq_updated before update on public.faq for each row execute function public.set_updated_at();

-- --------------------------------------------------------------- politicas
create table public.politicas (
  id          uuid primary key default gen_random_uuid(),
  cliente_id  uuid not null references public.clientes(id) on delete cascade,
  tipo        text not null,                    -- 'cancelacion','checkin','checkout','pagos','mascotas','menores',...
  titulo      text not null,
  texto_es    text not null,
  texto_en    text,
  escala_si   text,                             -- condiciones que obligan a pasar a humano
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (cliente_id, tipo)
);
create trigger trg_politicas_updated before update on public.politicas for each row execute function public.set_updated_at();

-- ------------------------------------------------------------- formularios
create table public.formularios (
  id              uuid primary key default gen_random_uuid(),
  cliente_id      uuid not null references public.clientes(id) on delete cascade,
  intencion       text not null,                -- 'india', 'voluntariado', 'formacion', 'retiros', 'facilitadores'
  nombre          text not null,
  disparadores    text[] not null default '{}', -- palabras que activan el formulario (router, sin LLM)
  mensaje_intro   jsonb not null default '{}',  -- {"es","en"}
  campos          jsonb not null default '[]',  -- [{clave, pregunta:{es,en}, tipo, obligatorio, opciones?}]
  mensaje_cierre  jsonb not null default '{}',
  destinatario    text,                         -- whatsapp E.164 del responsable del lead
  prioridad       integer not null default 0,
  activo          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (cliente_id, intencion)
);
create trigger trg_formularios_updated before update on public.formularios for each row execute function public.set_updated_at();

-- ----------------------------------------------------------- conversaciones
create table public.conversaciones (
  id                        uuid primary key default gen_random_uuid(),
  cliente_id                uuid not null references public.clientes(id) on delete cascade,
  chatwoot_conversation_id  integer not null,
  chatwoot_contact_id       integer,
  canal                     text not null check (canal in ('whatsapp','web')),
  telefono                  text,
  idioma                    text not null default 'es',
  pais                      text,                         -- ISO-2 inferido del prefijo (costo Meta)
  estado_bot                text not null default 'activo' check (estado_bot in ('activo','pausado')),
  motivo_escalamiento       text,
  escalado_at               timestamptz,
  reactivado_at             timestamptz,
  formulario_activo_id      uuid references public.formularios(id),
  formulario_estado         jsonb,                        -- {paso, datos}
  mensajes_entrantes        integer not null default 0,
  mensajes_salientes        integer not null default 0,
  tokens_entrada            integer not null default 0,
  tokens_salida             integer not null default 0,
  costo_llm_usd             numeric(10,6) not null default 0,
  primera_respuesta_ms      integer,
  ultimo_mensaje_at         timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (cliente_id, chatwoot_conversation_id)
);
create index idx_conv_cliente_estado on public.conversaciones (cliente_id, estado_bot, ultimo_mensaje_at);
create trigger trg_conversaciones_updated before update on public.conversaciones for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------- leads
create table public.leads (
  id               uuid primary key default gen_random_uuid(),
  cliente_id       uuid not null references public.clientes(id) on delete cascade,
  formulario_id    uuid references public.formularios(id),
  conversacion_id  uuid references public.conversaciones(id),
  intencion        text not null,
  datos            jsonb not null default '{}',
  estado           text not null default 'nuevo' check (estado in ('nuevo','contactado','cerrado','descartado')),
  asignado_a       text,
  notas            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index idx_leads_cliente_estado on public.leads (cliente_id, estado, created_at desc);
create trigger trg_leads_updated before update on public.leads for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- mensajes
create table public.mensajes (
  id                   uuid primary key default gen_random_uuid(),
  cliente_id           uuid not null references public.clientes(id) on delete cascade,
  conversacion_id      uuid not null references public.conversaciones(id) on delete cascade,
  chatwoot_message_id  bigint,
  rol                  text not null check (rol in ('huesped','bot','agente','sistema')),
  tipo                 text not null default 'texto',
  contenido            text,
  origen               text,                    -- 'router','formulario','llm','escalamiento'
  modelo               text,
  tokens_entrada       integer,
  tokens_salida        integer,
  latencia_ms          integer,
  herramientas_usadas  jsonb,
  created_at           timestamptz not null default now(),
  unique (cliente_id, chatwoot_message_id)
);
create index idx_mensajes_conv on public.mensajes (conversacion_id, created_at);

-- ========================================================================= RLS
-- Service role (brain, n8n) ignora RLS. Estas políticas aplican a JWT con claim cliente_id
-- (tablero de KPIs por cliente) y niegan todo lo demás.
create or replace function public.cliente_actual() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'cliente_id', '')::uuid
$$;

do $$
declare t text;
begin
  foreach t in array array['clientes','habitaciones','productos','clases','eventos','faq','politicas','formularios','conversaciones','leads','mensajes']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    if t = 'clientes' then
      execute 'create policy cliente_propio on public.clientes for select using (id = public.cliente_actual())';
    else
      execute format('create policy cliente_propio on public.%I for select using (cliente_id = public.cliente_actual())', t);
    end if;
  end loop;
end $$;

-- Sin grants a anon: el tablero usa un JWT firmado con cliente_id (se define en semana 3).
revoke all on all tables in schema public from anon;
