# Set de regresión
Un JSON por caso, tomado de las "Respuesta:" del documento de Diego (~50). Formato:
```json
{ "id": "faq-01", "cliente": "mandala", "entrada": "¿Cuánto cuesta hospedarse?", "idioma": "es",
  "esperado": { "origen": "llm", "debeContener": ["fechas", "personas"], "noDebeContener": ["$", "COP"], "escala": false } }
```
Se corre con `npm run test:regresion` antes de cada cambio a producción (semana 3).
