-- ============================================================================
-- Fase 1 #1 — lista de dominios permitidos para links (config_extra.dominios_permitidos). SOLO DATO.
-- NO aplicada: se corre a mano ANTES de desplegar la imagen nueva. Sin esta fila, la herramienta
-- generar_link_reserva queda bloqueada (falla cerrada) y Max dice que una persona ayudará con la reserva.
--
-- Corrección al informe: new-booking-staging.frontdeskmaster.com ES el motor de producción de Mandala
-- (no es un error). Es el único dominio permitido para links de hospedaje.
-- ============================================================================

update public.clientes
   set config_extra = coalesce(config_extra, '{}'::jsonb)
                      || jsonb_build_object('dominios_permitidos', jsonb_build_array('new-booking-staging.frontdeskmaster.com'))
 where slug = 'mandala';

-- ---- Vuelta atrás (comentada a propósito) ----
-- update public.clientes set config_extra = config_extra - 'dominios_permitidos' where slug = 'mandala';
