import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import path from 'path';
import type { Chunk, SearchResult, WebService, WebServiceDetail } from '../types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveDbPath(): string {
  const override = process.env.MCP_ARCA_DB_PATH;
  if (override) {
    // Validate: must resolve to an existing .db file. Protects against a malicious
    // MCP config trying to point the server at an arbitrary system file (/etc/passwd,
    // a prepared SQLite with poisoned chunks, etc.).
    const resolved = path.resolve(override);
    if (!resolved.endsWith('.db')) {
      throw new Error(`MCP_ARCA_DB_PATH debe terminar en .db (recibido: ${resolved})`);
    }
    if (!existsSync(resolved)) {
      throw new Error(`MCP_ARCA_DB_PATH no existe: ${resolved}`);
    }
    return resolved;
  }
  // Dev (tsx, src/services/) → ../../data, bundled (dist/) → ../data
  const candidates = [
    path.resolve(__dirname, '../../data/index.db'),
    path.resolve(__dirname, '../data/index.db'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  throw new Error(
    `index.db no encontrado. Rutas probadas: ${candidates.join(', ')}. ` +
    `Corré npm run ingest:build o definí MCP_ARCA_DB_PATH.`
  );
}

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) {
    db = new Database(resolveDbPath(), { readonly: true });
    try {
      sqliteVec.load(db);
    } catch {
      // sqlite-vec may not be available in all environments — KNN will fall back to FTS
    }
  }
  return db;
}

export function listWebServices(): WebService[] {
  const rows = getDb()
    .prepare('SELECT ws_id, name, description, source_urls FROM web_services ORDER BY name')
    .all() as Array<{ ws_id: string; name: string; description: string | null; source_urls: string }>;

  return rows.map((r) => ({
    wsId: r.ws_id,
    name: r.name,
    description: r.description,
    sourceUrls: JSON.parse(r.source_urls ?? '[]') as string[],
  }));
}

export function getDocumentChunks(source: string, maxChars: number): Array<Pick<Chunk, 'title' | 'section' | 'text'>> {
  const rows = getDb()
    .prepare('SELECT title, section, text FROM chunks WHERE source = ? ORDER BY id')
    .all(source) as Array<Pick<Chunk, 'title' | 'section' | 'text'>>;

  if (rows.length === 0) return [];

  // Truncate total content to maxChars, prioritizing full sections
  let total = 0;
  const result: Array<Pick<Chunk, 'title' | 'section' | 'text'>> = [];
  for (const row of rows) {
    const size = row.text.length + (row.section?.length ?? 0) + 2;
    if (total + size > maxChars && result.length > 0) break;
    result.push(row);
    total += size;
  }

  return result;
}

export function getWebService(wsId: string): WebServiceDetail | null {
  const ws = getDb()
    .prepare('SELECT ws_id, name, description, source_urls FROM web_services WHERE ws_id = ?')
    .get(wsId) as { ws_id: string; name: string; description: string | null; source_urls: string } | undefined;

  if (!ws) return null;

  const sections = getDb()
    .prepare('SELECT DISTINCT title, section FROM chunks WHERE ws_id = ? ORDER BY id')
    .all(wsId) as Array<{ title: string | null; section: string | null }>;

  return {
    wsId: ws.ws_id,
    name: ws.name,
    description: ws.description,
    sourceUrls: JSON.parse(ws.source_urls ?? '[]') as string[],
    sections,
  };
}

type ChunkRow = {
  id: number;
  ws_id: string;
  source: string;
  title: string | null;
  section: string | null;
  text: string;
  distance?: number;
};

const ES_STOP_WORDS = new Set([
  'de', 'del', 'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas',
  'en', 'y', 'o', 'u', 'a', 'para', 'con', 'por', 'sin', 'al',
  'que', 'qué', 'cómo', 'como', 'cuál', 'cual', 'cuáles', 'cuales',
  'cuando', 'cuándo', 'donde', 'dónde', 'quien', 'quién',
  'es', 'son', 'está', 'esta', 'están', 'sea', 'significa', 'quiero',
  'se', 'me', 'te', 'le', 'lo', 'nos', 'os', 'les',
  'mi', 'tu', 'su', 'mis', 'tus', 'sus',
  'si', 'no', 'ya', 'más', 'mas', 'muy', 'todo', 'todos', 'toda', 'todas',
]);

// "Rare" tokens are discriminative: codes ("10015"), CamelCase ("FECAESolicitar"),
// acronyms ("WSFEv1"). These narrow the search dramatically.
function isRareToken(t: string): boolean {
  if (/\d/.test(t)) return true;
  if (/[a-z][A-Z]|[A-Z][a-z]/.test(t)) return true;
  if ((t.match(/[A-Z]/g) ?? []).length >= 2) return true;
  return false;
}

// Build a cascade of FTS5 queries from most to least specific. The caller runs them in
// order, merging unique results. This surfaces exact-match chunks first while still
// recovering recall via OR if the specific combos don't exist in any chunk.
function buildFtsQueries(raw: string): string[] {
  const tokens = raw
    .replace(/["'*?^:()[\]{}+\\-]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !ES_STOP_WORDS.has(t.toLowerCase()));
  if (tokens.length === 0) return [];

  const quoted = (t: string) => `"${t}"`;
  const rare = tokens.filter(isRareToken);
  const queries: string[] = [];

  // 1. All rare tokens AND'd — most specific for queries with 2+ rare terms
  //    (e.g. "FECAESolicitar" AND "CAECodigo")
  if (rare.length >= 2) queries.push(rare.map(quoted).join(' AND '));

  // 2. All tokens AND'd — tight conceptual match, avoids a single generic rare token
  //    dominating (e.g. "consultar CUIT contribuyente" → the three-way AND, not just "CUIT")
  if (tokens.length >= 2) queries.push(tokens.map(quoted).join(' AND '));

  // 3. Each rare token alone — catches chunks that only contain a code/identifier
  //    without its surrounding context (e.g. chunk with "10015" but no "WSFEv1")
  for (const t of rare) queries.push(quoted(t));

  // 4. Broad OR — fallback recall for vague or unusual queries
  queries.push(tokens.map(quoted).join(' OR '));

  return [...new Set(queries)];
}

function runVectorSearch(
  db: Database.Database,
  embedding: number[],
  wsId: string | undefined,
  limit: number
): ChunkRow[] {
  const vecBlob = Buffer.from(new Float32Array(embedding).buffer);
  // sqlite-vec applies WHERE AFTER KNN — oversample when filtering.
  const k = wsId ? Math.min(limit * 20, 500) : limit;

  const sql = wsId
    ? `SELECT c.id, c.ws_id, c.source, c.title, c.section, c.text, v.distance
       FROM chunks_vec v JOIN chunks c ON c.id = v.chunk_id
       WHERE v.embedding MATCH ? AND k = ? AND c.ws_id = ?
       ORDER BY v.distance LIMIT ?`
    : `SELECT c.id, c.ws_id, c.source, c.title, c.section, c.text, v.distance
       FROM chunks_vec v JOIN chunks c ON c.id = v.chunk_id
       WHERE v.embedding MATCH ? AND k = ?
       ORDER BY v.distance`;

  const params = wsId ? [vecBlob, k, wsId, limit] : [vecBlob, k];
  return db.prepare(sql).all(...params) as ChunkRow[];
}

function runFtsQuery(
  db: Database.Database,
  ftsQuery: string,
  wsId: string | undefined,
  limit: number
): ChunkRow[] {
  if (!ftsQuery) return [];
  const sql = wsId
    ? `SELECT c.id, c.ws_id, c.source, c.title, c.section, c.text
       FROM chunks_fts f JOIN chunks c ON c.id = f.rowid
       WHERE f.text MATCH ? AND f.ws_id = ?
       ORDER BY bm25(chunks_fts) LIMIT ?`
    : `SELECT c.id, c.ws_id, c.source, c.title, c.section, c.text
       FROM chunks_fts f JOIN chunks c ON c.id = f.rowid
       WHERE f.text MATCH ?
       ORDER BY bm25(chunks_fts) LIMIT ?`;

  const params = wsId ? [ftsQuery, wsId, limit] : [ftsQuery, limit];
  try {
    return db.prepare(sql).all(...params) as ChunkRow[];
  } catch {
    // Malformed FTS query — return empty rather than crashing search
    return [];
  }
}

// Run queries in cascade order. Merge unique results preserving cascade priority:
// chunks surfaced by more-specific queries get a better rank in the merged list.
function runFtsSearch(
  db: Database.Database,
  queries: string[],
  wsId: string | undefined,
  limit: number
): ChunkRow[] {
  const seen = new Set<number>();
  const merged: ChunkRow[] = [];
  for (const q of queries) {
    if (merged.length >= limit) break;
    const results = runFtsQuery(db, q, wsId, limit);
    for (const r of results) {
      if (merged.length >= limit) break;
      if (!seen.has(r.id)) {
        merged.push(r);
        seen.add(r.id);
      }
    }
  }
  return merged;
}

// Reciprocal Rank Fusion (Cormack et al. 2009). Combines rankings from vec + fts.
// score(c) = sum over ranked lists of 1 / (k + rank_in_list). k=60 is the standard constant.
function rrfMerge(lists: ChunkRow[][], topK: number, k = 60): ChunkRow[] {
  const scores = new Map<number, { row: ChunkRow; score: number }>();
  for (const list of lists) {
    list.forEach((row, idx) => {
      const rank = idx + 1;
      const contrib = 1 / (k + rank);
      const entry = scores.get(row.id);
      if (entry) {
        entry.score += contrib;
      } else {
        scores.set(row.id, { row, score: contrib });
      }
    });
  }
  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ row }) => row);
}

export function searchDocs(
  embedding: number[],
  rawQuery: string,
  wsId: string | undefined,
  topK: number
): SearchResult[] {
  const database = getDb();

  const hasVec = database
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chunks_vec'")
    .get();
  const hasFts = database
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chunks_fts'")
    .get();

  // Oversample from each source so RRF has material to merge.
  const perSource = Math.max(topK * 3, 15);

  const vecResults = hasVec ? runVectorSearch(database, embedding, wsId, perSource) : [];
  const ftsQueries = buildFtsQueries(rawQuery);
  const ftsResults =
    hasFts && ftsQueries.length > 0 ? runFtsSearch(database, ftsQueries, wsId, perSource) : [];

  // If neither source produced anything, fall back to plain LIMIT (DB might be mis-built).
  if (vecResults.length === 0 && ftsResults.length === 0) {
    const rows = database
      .prepare(
        `SELECT id, ws_id, source, title, section, text FROM chunks ${wsId ? 'WHERE ws_id = ?' : ''} LIMIT ?`
      )
      .all(...(wsId ? [wsId, topK] : [topK])) as ChunkRow[];
    return rows.map((r) => ({
      id: r.id,
      wsId: r.ws_id,
      source: r.source,
      title: r.title,
      section: r.section,
      text: r.text,
      distance: 0,
    }));
  }

  // If only one source has results, use it directly — no RRF needed.
  const fused =
    vecResults.length === 0
      ? ftsResults.slice(0, topK)
      : ftsResults.length === 0
        ? vecResults.slice(0, topK)
        : rrfMerge([vecResults, ftsResults], topK);

  // Preserve vector distance when the chunk was found by KNN (useful for debugging).
  const distanceById = new Map(vecResults.map((r) => [r.id, r.distance ?? 0]));
  return fused.map((r) => ({
    id: r.id,
    wsId: r.ws_id,
    source: r.source,
    title: r.title,
    section: r.section,
    text: r.text,
    distance: distanceById.get(r.id) ?? 0,
  }));
}
