# Prueba de LLM (semana 2)

Elige el modelo de IA de Mandala con datos, no a ojo. Corre `preguntas.json` (60 casos) contra varios modelos usando el
**código real del cerebro** (mismo prompt, mismas herramientas contra Supabase, mismo router); solo cambia el modelo.
Solo LEE de Supabase. No escribe nada ni toca Chatwoot, Redis ni n8n.

## Qué mide (en este orden)
1. Que **no invente** dinero ni datos. Un monto cuenta como inventado si no viene de lo que devolvió una herramienta en ese turno, de la lista fija o de lo que dijo el huésped; uno solo descalifica.
2. Que **pase a una persona** cuando debe (`[[NO_SE]]`) y no cuando no debe.
3. Que llame la **herramienta correcta con argumentos válidos** (ej. el link de reserva con las fechas correctas).
4. Que sea **consistente**: cada caso se corre 3 veces; pasar 2 de 3 no cuenta.
5. Errores de la API, latencia (p50/p95) y costo por 1000 turnos.

El tono y la calidez NO los juzga el código: los revisa una persona, a ciegas (paso siguiente).

## Criterios de aprobación
Fijados en `evaluar.ts` (`CRITERIOS`) **antes** de correr. No se cambian después de ver resultados.

## Cómo se corre (en la Mac, dentro de ~/jutilabs-brain)
1. `.env` local con: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` y `OPENROUTER_KEY_PRUEBA_LLM`
   (clave de OpenRouter propia de esta prueba, con tope de gasto de ~USD 5).
2. `npm run prueba:llm -- datos` → qué datos ve el bot hoy y avisos (¿está India? ¿hay link de reserva?). Hacerlo ANTES.
3. `npm run prueba:llm -- --casos A01,R01,B01 --rep 1` → prueba de humo (centavos).
4. `npm run prueba:llm` → prueba completa. Resultados en `tests/prueba-llm/resultados/<fecha>/` (`resumen.md` + un `.jsonl` por modelo con todo el detalle).

Opciones: `--modelos a,b` · `--rep 3` · `--cuenta 1` (cuenta de Mandala en Chatwoot) · `--casos ID,ID` · `--concurrencia 3` · `--razonamiento auto|apagado|normal`.

**Razonamiento.** En modo `auto` (por defecto) se APAGA (`reasoning.enabled=false` de OpenRouter) en cada modelo que lo permita; los que lo exigen (Gemini 3.5 Flash-Lite) se prueban con el suyo, y el resumen dice cuál usó cada uno. Motivo: el cerebro obliga a consultar una herramienta en cada mensaje (`tool_choice: required`) y los modelos que piensan por defecto lo rechazan (Qwen 3.8 Flash: error 400 de Alibaba). En producción se configura igual, por cliente, en Supabase: `clientes.config_extra` → `{"llmExtra": {"reasoning": {"enabled": false}}}`. `--razonamiento apagado` lo manda a todos y `--razonamiento normal` no manda nada.

**Límite de velocidad (429).** El corredor reintenta hasta 3 veces (4, 12 y 30 s) y cuenta cuántos reintentos hizo cada modelo; si igual no responde, cuenta como error de la API.

## Archivos
- `preguntas.json` — los casos, con qué debe pasar en cada uno y verificaciones automáticas.
- `evaluar.ts` — calificación automática (pura; con tests en `tests/unitarias/pruebaLlmEvaluar.test.ts`).
- `correr.ts` — el corredor.

## Límites conocidos
- El modelo de respaldo se apaga a propósito para medir cada modelo solo; producción sí lo usa.
- No usa `llamarLLMConReintento`: mide la confiabilidad "cruda" (producción reintenta una vez si falla rápido).
- No detecta montos escritos como "66 mil pesos".
- El chequeo de idioma es una heurística (es/en). El alemán solo se mide como "no se rompe y es útil": el bot solo maneja es/en.
- Los precios de la tabla de costos son de lista (29-sep-2026); confirmar en OpenRouter antes de decidir.
