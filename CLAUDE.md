# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build          # compile src/ → dist/ (tsup, ESM)
npm run dev            # hot reload the MCP server via tsx watch
npm run ingest:build   # run the full ingestion pipeline → data/index.db
npm test               # smoke tests (require data/index.db to exist first)
npx tsc --noEmit       # type-check all files including ingest/ and test/
```

Docker (preferred for ingestion, avoids native-dep friction):

```bash
docker compose run --rm ingest   # build data/index.db inside container
docker compose run --rm dev npm test
```

## Architecture

Two completely separate concerns share one repo:

### 1. MCP server (`src/`) — published to npm

Runs as a stdio MCP server (`node dist/index.js`). End users never run ingestion.

- `src/index.ts` — entry point, wires `Server` + `StdioServerTransport`
- `src/server.ts` — registers all tools via `setRequestHandler` for `ListTools` and `CallTool`
- `src/tools/*.tool.ts` — one file per MCP tool; each exports a zod schema + handler function
- `src/services/embedder.ts` — singleton `@huggingface/transformers` pipeline (`Xenova/multilingual-e5-small`, q8). Lazy-init on first call; downloads ~120 MB to `~/.cache/huggingface/` once.
- `src/services/vector-store.ts` — opens `data/index.db` read-only. Attempts to load the `sqlite-vec` extension for KNN; silently falls back to LIMIT-based retrieval if unavailable.

### 2. Ingestion pipeline (`ingest/`) — not published

CLI run by the maintainer (or GitHub Actions) to rebuild `data/index.db`.

Pipeline steps in order (`ingest/build-index.ts`):
1. **Crawl** (`crawl.ts`) — fetches HTML/PDF/WSDL from URLs in `ingest/sources.json`. Caches raw files to `ingest/.cache/` (git-ignored). Rate-limited to 1 req/sec.
2. **Parse** (`parse.ts`) — extracts structured text per document type: `cheerio` for HTML, `pdfjs-dist` for PDF, XML parsing for WSDL.
3. **Chunk** (`chunk.ts`) — recursive character splitter, ~1800 chars with 200-char overlap.
4. **Embed** (`embed.ts`) — calls `embedPassages()` from the shared embedder service in batches of 32. Uses `"passage: "` prefix (required by multilingual-e5).
5. **Write** (`build-index.ts`) — writes `chunks`, `chunks_vec` (sqlite-vec virtual table, FLOAT[384]), `web_services`, and `meta` tables.

### Critical invariant: same model at ingest and query time

`embedder.ts` is imported by both `ingest/embed.ts` and `src/services/embedder.ts`. Both sides must use `Xenova/multilingual-e5-small` with identical pooling/normalize settings. At query time the prefix is `"query: "`, at ingest time it is `"passage: "` — this is required by the e5 model spec.

### Adding a new web service

1. Add an entry to `ingest/sources.json` with `name`, `description`, and `entrypoints`.
2. Re-run `npm run ingest:build` (or `docker compose run --rm ingest`).
3. Commit the updated `data/index.db`.

### sqlite-vec notes

`data/index.db` is built with the `sqlite-vec` extension loaded. At runtime, `vector-store.ts` tries `require.resolve('sqlite-vec/vec0')` and falls back gracefully if unavailable. When the extension is missing, `search_docs` returns rows in insertion order (not by semantic similarity) — this is intentional for environments where native extensions cannot load.

### Publishing

`package.json` `files` includes `dist/`, `data/index.db`, `README.md`, `LICENSE`. The `ingest/`, `test/`, `Dockerfile`, and `docker-compose.yml` are excluded via `.npmignore`. Run `npm publish` after tagging — the `prepublishOnly` hook runs `build` automatically.
