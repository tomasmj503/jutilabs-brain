# Regresión

Casos de regresión que corren **sin Docker y sin modelo real**: se ejecuta el código del cerebro
(router, turno, escalamiento, estado) con los bordes simulados:

| Borde | Fake |
|---|---|
| Supabase | `fakes/supabase.ts` (en memoria, respeta llaves únicas y puede «caerse») |
| Redis | `../unitarias/redisFalso.ts` |
| Chatwoot, n8n/Telegram | `fakes/mundo.ts` (registra mensajes, notas, avisos) |
| OpenRouter | guion por turno en el propio caso (`modelo`) |

Prueban **lo que decide el código**: cuántos mensajes salen, si se pausa, si se avisa al equipo, cuántas veces
se llama al modelo. No prueban la calidad de las respuestas (eso es `tests/prueba-llm`, con el modelo real).

## Formato (`casos/*.json`)
```json
{ "id": "tec-01", "ref": "#3 / PC-12", "descripcion": "…", "pendiente": "#3",
  "cliente": { "temasQueEscalan": ["india"] },
  "conversacion": { "estadoBot": "pausado", "escaladoHaceHoras": 6, "motivo": "agente_respondio" },
  "baseCaida": false,
  "turnos": [ { "mensajes": [{ "texto": "…", "adjuntos": ["imagen"] }],
                "modelo": { "texto": "…", "herramientas": [], "noSeElDato": false, "error": { "status": 402 } },
                "esperado": { "mensajesAlHuesped": 1 } } ],
  "esperado": { "mensajesAlHuesped": 1, "pausado": false, "avisosAlEquipo": 1, "llamadasAlModelo": 1,
                "conversacionesAbiertas": 0, "noDiceAlHuesped": ["ya avisé"] } }
```
`pendiente` marca un caso que **hoy debe fallar** (corre como `it.fails`) porque su arreglo está en otro punto de la
Fase 1. Al hacer el arreglo, el caso empieza a pasar, `it.fails` lo avisa en rojo y se quita la marca en el mismo commit.

Se corre con `npm run test:regresion` (también en CI).
