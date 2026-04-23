# mcp-arca-afip

[![npm version](https://img.shields.io/npm/v/mcp-arca-afip.svg)](https://www.npmjs.com/package/mcp-arca-afip)
[![license](https://img.shields.io/npm/l/mcp-arca-afip.svg)](./LICENSE)
[![MCP](https://img.shields.io/badge/MCP-compatible-0a84ff)](https://modelcontextprotocol.io)

Servidor **MCP** (Model Context Protocol) que expone la documentación oficial de los web services de **ARCA/AFIP** a **Claude Code** (y cualquier otro cliente MCP: Cursor, Windsurf, Claude Desktop, etc.) con búsqueda híbrida **BM25 + semántica**.

> ⚠️ **Este proyecto no está afiliado con AFIP/ARCA.** Indexa documentación pública publicada en [afip.gob.ar](https://www.afip.gob.ar/ws/documentacion/default.asp). Los manuales, WSDLs y textos son propiedad de sus autores originales.

---

## Qué incluye

- **51 web services indexados** (todos los documentados en `afip.gob.ar/ws/documentacion`)
- **3.832 chunks** con embeddings locales (sin API keys, sin llamadas a servicios pagos)
- **4 tools MCP**: `search_docs`, `list_web_services`, `get_web_service`, `get_document`
- **Búsqueda híbrida** con cascade BM25 + semantic + RRF (Reciprocal Rank Fusion)
- **WSDLs + manuales PDF + páginas HTML** (incluye el manual Sphinx del ambiente de Homologación WSASS)

### Servicios cubiertos

Autenticación, certificados, factura electrónica (WSFEv1, WSMTXCA, WSBFEv1, WSFEX, WSCT, WSSEG), padrón A4/A5/A10/A13/A100, constancia de inscripción, WSCDCV1, carta de porte electrónica, liquidación primaria de granos, sector pecuario, caña de azúcar, tabaco, lechería, bienes de uso, aduana (WSSV, WGESINV, WDEPMOVIMIENTOS, WSCES, etc.), retenciones SIRE-IVA, Trabajo F931, y más.

---

## Instalación en Claude Code

Desde cualquier terminal, una sola línea:

```bash
claude mcp add arca-afip --scope user -- npx -y mcp-arca-afip
```

Verificá que esté conectado:

```bash
claude mcp list
# arca-afip: npx -y mcp-arca-afip - ✓ Connected
```

### Alcances (scope)

| Flag | Dónde queda disponible |
|------|------------------------|
| `--scope user` (recomendado) | Todos tus proyectos en esta máquina |
| `--scope project` | Solo este repo — crea `.mcp.json` commiteable para que tu equipo lo use |
| `--scope local` | Solo este repo, sin committear |

### Primera ejecución

La primera query desde Claude Code descarga un modelo de embeddings de ~130 MB a `~/.cache/mcp-arca-afip/models/`. **Una sola vez por máquina y usuario**; el cache sobrevive a `npx -y ...@latest` (nuevas versiones del paquete **no** re-descargan el modelo). Después de esa primera query, cero red y ~100 ms por consulta.

### Actualizar a la última versión

`npx -y mcp-arca-afip@latest` en el comando de instalación levanta siempre la versión más reciente. Si ya lo tenías instalado:

```bash
claude mcp remove arca-afip --scope user
claude mcp add arca-afip --scope user -- npx -y mcp-arca-afip@latest
```

### Otros clientes MCP

Funciona en cualquier cliente compatible con MCP (Cursor, Windsurf, Claude Desktop, etc.) usando el comando `npx -y mcp-arca-afip` como `command` del server. Ver la [doc oficial del protocolo](https://modelcontextprotocol.io) para el formato específico de cada cliente.

---

## Tools disponibles

### `search_docs`
Búsqueda híbrida (BM25 + semántica) sobre toda la documentación.

```
query: "cómo autorizar factura B"   // pregunta en lenguaje natural o término exacto
wsId: "wsfev1"                       // opcional — filtrá por WS
topK: 8                              // opcional — default 8
```

Devuelve los chunks más relevantes con URL fuente. Cuando matchea un código de error literal (`10015`), un nombre de operation (`FECAESolicitar`), o un campo (`CAECodigo`), el BM25 prioriza el chunk exacto; para queries en lenguaje natural, el ranking semántico toma la posta.

### `list_web_services`
Lista todos los WS indexados con su ID y descripción. Útil como primer paso para saber qué `wsId` pasarle a los demás tools.

### `get_web_service`
Metadata + tabla de contenidos de un WS específico.

```
wsId: "wsfev1"
```

### `get_document`
Devuelve el manual completo reconstruido desde sus chunks (hasta ~60k chars). Usalo cuando `search_docs` devuelve un fragmento pero necesitás el contexto completo o el schema XML entero.

```
source: "https://www.afip.gob.ar/ws/documentacion/manuales/manual-desarrollador-ARCA-COMPG-v4-1.pdf"
maxChars: 60000   // opcional
```

---

## Ejemplos de uso con Claude

- *"¿Qué significa el error 10015 en WSFEv1?"* — BM25 trae el chunk exacto
- *"¿Qué campos lleva FECAESolicitar?"* — match exacto sobre el operation
- *"Paso a paso para autorizar mi primera factura A, desde el TA hasta el CAE"* — multi-hop: WSAA + WSFEv1
- *"¿Cuál es la estructura del response de `getPersona` en Padrón A13?"* — encuentra el chunk del WSDL, si hace falta llama `get_document` para el schema completo
- *"¿Cuándo uso Padrón A4 vs A10 vs A13 vs A100?"* — comparativa cross-WS

---

## Ejecutar local (desarrollo)

Si querés clonar el repo y correr la pipeline de ingesta vos mismo (para refrescar la doc, agregar un WS, o hackear el código):

### Requisitos

- **Node 20+** (`.nvmrc` incluido)
- **Docker** (opcional, recomendado para la ingesta — evita instalar deps nativas)

### Clonar y preparar

```bash
git clone https://github.com/faeralan/mcp-arca-afip.git
cd mcp-arca-afip
npm ci
```

### Reconstruir el índice desde cero

Descarga los PDFs/HTML de AFIP, parsea, chunkea, embebe, y genera `data/index.db`.

```bash
npm run ingest:build
```

Primera corrida: ~15–25 min (descarga modelo de embeddings + embebe ~3.800 chunks). Corridas siguientes: casi instantáneas gracias al cache de embeddings en `ingest/.cache/`.

Con Docker (más reproducible, sin instalar `better-sqlite3` nativo localmente):

```bash
docker compose run --rm ingest
```

### Correr smoke tests

Requiere `data/index.db` ya construido.

```bash
npm test
```

### Verificar cobertura contra AFIP

Compara lo indexado contra lo que AFIP publica hoy en sus páginas índice. Reporta qué URLs faltan y cuáles están en `sources.json` pero no se indexaron.

```bash
npm run ingest:coverage
```

### Build del server MCP

```bash
npm run build     # compila src/ → dist/ (ESM bundle)
npm run dev       # hot reload durante desarrollo
```

### Probar el MCP localmente (sin npm)

```bash
claude mcp add arca-afip-local --scope user -- node $(pwd)/dist/index.js
```

---

## Cómo funciona

```
Build-time (una sola vez, lo corre el mantenedor)
─────────────────────────────────────────────────
sources.json (curado)
   ↓ crawler con rate-limit + cache en disco
   ↓ parser: pdfjs-dist para PDF, cheerio para HTML, regex XML para WSDLs
   ↓ chunker recursivo (~1800 chars, overlap 200)
   ↓ dedup por SHA1(source+text)
   ↓ embedder (multilingual-e5-small, 384-dim, q8, local sin API key)
   ↓ escritura atómica a SQLite (chunks + chunks_vec + chunks_fts)

Runtime (cada query del usuario, ~100ms total)
──────────────────────────────────────────────
Query → embed(query) → KNN sobre sqlite-vec  ─┐
      ↘                                       ├─→ RRF merge → top-K chunks
         cascade BM25 sobre FTS5 ────────────┘
```

### Decisiones técnicas

- **Todo local, sin API keys** — embeddings con `@huggingface/transformers` + modelo `multilingual-e5-small` en Node, tokenize con `unicode61 remove_diacritics 2` para manejar acentos en español.
- **Cascade FTS5** — primero AND de rare tokens (números, CamelCase), después AND de todos los tokens, luego tokens rare individuales, finalmente OR. Esto prioriza chunks con el término literal (`10015`, `FECAESolicitar`) sin perder recall para queries vagas.
- **Reciprocal Rank Fusion (k=60)** — merge de rankings BM25 + semantic (Cormack et al. 2009).
- **sqlite-vec** — extensión nativa de SQLite, KNN real sin servicios externos.

---

## Contribuir

Issues y PRs bienvenidos. Para agregar un WS nuevo:

1. Editá `ingest/sources.json` agregando una entry con su URL.
2. Corré `npm run ingest:build` — las embeddings existentes pegan cache, solo los chunks nuevos se embeben.
3. Corré `npm test` para validar.
4. Abrí un PR.

Para actualizar la documentación ante cambios de AFIP: corré `npm run ingest:coverage` que compara contra AFIP live y señala diferencias.

---

## Licencia

MIT © [faeralan](https://github.com/faeralan)

## Agradecimientos

- [Model Context Protocol](https://modelcontextprotocol.io) por el protocolo y SDK
- [sqlite-vec](https://github.com/asg017/sqlite-vec) por el KNN embebido
- [Xenova/multilingual-e5-small](https://huggingface.co/intfloat/multilingual-e5-small) por los embeddings multilingües
