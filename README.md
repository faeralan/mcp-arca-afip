# mcp-arca-afip

[![npm version](https://img.shields.io/npm/v/mcp-arca-afip.svg?style=flat-square&color=cb3837)](https://www.npmjs.com/package/mcp-arca-afip)
[![npm downloads](https://img.shields.io/npm/dm/mcp-arca-afip.svg?style=flat-square&color=cb3837)](https://www.npmjs.com/package/mcp-arca-afip)
[![node](https://img.shields.io/node/v/mcp-arca-afip.svg?style=flat-square)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/mcp-arca-afip.svg?style=flat-square)](./LICENSE)
[![MCP compatible](https://img.shields.io/badge/MCP-compatible-0a84ff?style=flat-square)](https://modelcontextprotocol.io)

Servidor **MCP** (Model Context Protocol) que expone la documentación oficial de los web services de **ARCA/AFIP** a **Claude Code** (y cualquier otro cliente MCP: Cursor, Windsurf, Claude Desktop, etc.) con búsqueda híbrida **BM25 + semántica**.

**Disponible en npm**: [`mcp-arca-afip`](https://www.npmjs.com/package/mcp-arca-afip) · sin API keys, sin infra hosteada, todo local.

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

## Quick start

```bash
claude mcp add arca-afip --scope user -- npx -y mcp-arca-afip
```

Reiniciá Claude Code y preguntale algo como *"¿qué significa el error 10015 en WSFEv1?"*. Listo.

---

## Instalación detallada

Desde cualquier terminal:

```bash
claude mcp add arca-afip --scope user -- npx -y mcp-arca-afip
```

`npx -y` resuelve siempre la última versión publicada en [npm](https://www.npmjs.com/package/mcp-arca-afip) y la ejecuta sin `install` previo. El paquete pesa ~7.7 MB.

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
Búsqueda híbrida sobre toda la documentación.

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