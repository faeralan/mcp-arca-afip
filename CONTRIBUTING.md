# Contribuir a mcp-arca-afip

Gracias por querer ayudar. Casos comunes:

## Agregar un web service nuevo

1. Fork + clone.
2. `npm ci`.
3. Editá `ingest/sources.json` agregando una entry:
   ```json
   "ws_nuevo": {
     "name": "WS Nuevo — Descripción corta",
     "description": "Qué hace y cuándo se usa.",
     "entrypoints": [
       "https://www.afip.gob.ar/ws/.../manual.pdf",
       "https://wswhomo.afip.gov.ar/..../service.asmx?WSDL"
     ]
   }
   ```
4. Corré `npm run ingest:build`. Las embeddings existentes pegan cache; solo los chunks nuevos se embeben.
5. `npm test` (tiene que pasar 25/25).
6. Abrí el PR con un breve "por qué es útil este WS".

## Reportar documentación desactualizada

Corré `npm run ingest:coverage` contra la página live de AFIP. Si detecta URLs nuevas o rotas, abrí un issue con la salida del comando.

## Mejorar el crawler / parser / search

- `ingest/crawl.ts` — descarga + detección de tipo
- `ingest/parse.ts` — PDF (pdfjs-dist), HTML (cheerio con Sphinx-aware stripping), WSDL (regex sobre tags con namespace)
- `ingest/chunk.ts` — recursive splitter
- `ingest/embed.ts` — cache + batch embedding
- `src/services/vector-store.ts` — búsqueda híbrida con cascade FTS5 + RRF merge

Tests están en `test/smoke.ts` — agregá uno si tu cambio afecta resultados.

## Código

TypeScript estricto, ESM, Node ≥ 20. Sin frameworks — es código directo pensado para que cualquiera entienda el pipeline leyendo los 6 archivos de `ingest/` + 3 de `src/services/`.

## Licencia

Al contribuir aceptás que tu aporte se publica bajo [MIT](./LICENSE).
