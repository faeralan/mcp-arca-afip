/**
 * Coverage report — scrapes AFIP's live documentation index pages and compares
 * against what we have indexed. Reports PDFs/HTML pages published by AFIP that
 * are NOT yet in our sources.json.
 *
 * Run: npx tsx ingest/coverage-report.ts
 */
import { fetch } from 'undici';
import { load } from 'cheerio';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import sources from './sources.json' with { type: 'json' };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '../data/index.db');

const INDEX_PAGES = [
  'https://www.afip.gob.ar/ws/documentacion/catalogo.asp',
  'https://www.afip.gob.ar/ws/documentacion/ws-factura-electronica.asp',
  'https://www.afip.gob.ar/ws/documentacion/homologacion-externa.asp',
  'https://www.afip.gob.ar/ws/documentacion/wsaa.asp',
  'https://www.afip.gob.ar/ws/documentacion/certificados.asp',
];

const UA = 'mcp-arca-afip-coverage/0.1.0';

async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

function extractLinks(html: string, baseUrl: string): string[] {
  const $ = load(html);
  const urls = new Set<string>();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || href.startsWith('#') || href.startsWith('mailto:')) return;
    const resolved = href.startsWith('http') ? href : new URL(href, baseUrl).href;
    // Only AFIP docs: PDFs, HTML doc pages, WSDLs
    if (!resolved.includes('afip.gob.ar') && !resolved.includes('afip.gov.ar')) return;
    if (resolved.includes('arca.gob.ar/landing') || resolved.includes('biblioteca.afip')) return;
    const isPdf = resolved.endsWith('.pdf');
    const isWsdl = resolved.toLowerCase().includes('wsdl') || resolved.endsWith('.asmx');
    const isHtmlDoc = (resolved.includes('/ws/documentacion/') || resolved.includes('/ws/WSASS/html'))
      && (resolved.endsWith('.asp') || resolved.endsWith('.html'));
    if (isPdf || isWsdl || isHtmlDoc) urls.add(resolved);
  });
  return [...urls];
}

function normalizeUrl(u: string): string {
  // Normalize: lowercase the ?WSDL / ?wsdl, decode %20, drop index.html and trailing slash
  return u.replace(/\?WSDL$/i, '?WSDL').replace(/%20/g, ' ').replace(/\/index\.html$/, '').replace(/\/$/, '');
}

// Navigation pages that only list other docs — nothing worth indexing on their own.
const IGNORED_URLS = new Set([
  'https://www.afip.gob.ar/ws/documentacion/catalogo.asp',
  'https://www.afip.gob.ar/ws/documentacion/default.asp',
]);

function dirOf(u: string): string {
  return u.slice(0, u.lastIndexOf('/') + 1).toLowerCase();
}

async function lastModified(u: string): Promise<number | null> {
  try {
    const res = await fetch(u.replace(/ /g, '%20'), {
      method: 'HEAD',
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(20_000),
    });
    const lm = res.ok ? res.headers.get('last-modified') : null;
    return lm ? Date.parse(lm) : null;
  } catch {
    return null;
  }
}

/**
 * AFIP keeps every historical manual version online in the same folder (manual_wslsp_1.0.pdf …
 * manual_wslsp_2.0.6.pdf). A missing URL is treated as a *version* of an indexed doc when it
 * lives in a folder we already cover. Filenames aren't comparable (WSLPGV19 vs wslpg_1.24),
 * so Last-Modified decides whether it's newer or older. An unnumbered file with the same
 * Last-Modified as the indexed doc (e.g. WSSV/RutaDeCalibracion.pdf) stays as MISSING.
 */
async function classifyMissing(missing: string[], sourceUrls: Set<string>) {
  const sourcesByDir = new Map<string, string[]>();
  for (const u of sourceUrls) {
    const d = dirOf(u);
    sourcesByDir.set(d, [...(sourcesByDir.get(d) ?? []), u]);
  }

  const newDocs: string[] = [];
  const newer: Array<{ url: string; replaces: string[] }> = [];
  const older: string[] = [];
  const lmCache = new Map<string, number | null>();
  const lm = async (u: string) => {
    if (!lmCache.has(u)) lmCache.set(u, await lastModified(u));
    return lmCache.get(u)!;
  };

  for (const u of missing) {
    const siblings = sourcesByDir.get(dirOf(u));
    if (!siblings || !u.endsWith('.pdf')) {
      newDocs.push(u);
      continue;
    }
    const mine = await lm(u);
    const theirs = (await Promise.all(siblings.map(lm))).filter((t): t is number => t !== null);
    const numbered = /\d/.test(u.slice(u.lastIndexOf('/') + 1));
    if (mine === null || theirs.length === 0) {
      newDocs.push(u); // can't tell — surface it rather than hide it
    } else if (mine > Math.max(...theirs)) {
      newer.push({ url: u, replaces: siblings });
    } else if (mine < Math.max(...theirs) || numbered) {
      older.push(u);
    } else {
      newDocs.push(u); // same upload batch, no version number: likely a companion doc
    }
  }
  return { newDocs, newer, older };
}

async function main() {
  console.log('=== AFIP documentation coverage report ===\n');

  // Collect all URLs AFIP links from its index pages
  const liveUrls = new Set<string>();
  for (const page of INDEX_PAGES) {
    try {
      console.log(`Fetching ${page}...`);
      const html = await fetchPage(page);
      const links = extractLinks(html, page);
      links.forEach((u) => liveUrls.add(normalizeUrl(u)));
      console.log(`  found ${links.length} doc URLs`);
    } catch (err) {
      console.warn(`  skipped: ${(err as Error).message}`);
    }
  }

  // Collect all URLs in sources.json
  const sourceUrls = new Set<string>();
  for (const ws of Object.values(sources as Record<string, { entrypoints: string[] }>)) {
    ws.entrypoints.forEach((u) => sourceUrls.add(normalizeUrl(u)));
  }

  // Collect all URLs actually in the DB
  const db = new Database(DB_PATH, { readonly: true });
  const indexed = db.prepare('SELECT DISTINCT source FROM chunks').all() as Array<{ source: string }>;
  const indexedUrls = new Set(indexed.map((r) => normalizeUrl(r.source)));
  db.close();

  // Report 1: URLs AFIP publishes but we DON'T have in sources.json
  const missingAll = [...liveUrls].filter((u) => !sourceUrls.has(u) && !IGNORED_URLS.has(u)).sort();
  console.log(`\nChecking Last-Modified for ${missingAll.length} unlisted URLs...`);
  const { newDocs: missing, newer, older } = await classifyMissing(missingAll, sourceUrls);

  console.log('\n\n=== MISSING: on AFIP site, not in sources.json ===');
  if (missing.length === 0) {
    console.log('(none — sources.json covers everything AFIP currently links)');
  } else {
    for (const u of missing) console.log(`  - ${u}`);
    console.log(`\n  → ${missing.length} URLs faltantes`);
  }

  // Report 1b: a newer manual version than the one in sources.json
  console.log('\n\n=== NEWER VERSION: newer than the indexed doc in the same folder ===');
  if (newer.length === 0) {
    console.log('(none)');
  } else {
    for (const { url, replaces } of newer) console.log(`  - ${url}\n      (en sources.json: ${replaces.join(', ')})`);
    console.log(`\n  → ${newer.length} versiones nuevas`);
  }

  // Report 2: URLs in sources.json but NOT actually indexed (crawl failures)
  console.log('\n\n=== IN sources.json but NOT indexed (crawl/parse failed) ===');
  const notIndexed = [...sourceUrls].filter((u) => !indexedUrls.has(u)).sort();
  if (notIndexed.length === 0) {
    console.log('(none — every source.json entry produced at least one chunk)');
  } else {
    for (const u of notIndexed) console.log(`  - ${u}`);
    console.log(`\n  → ${notIndexed.length} URLs sin chunks`);
  }

  // Report 3: URLs indexed but NOT from sources.json (discovered via HTML crawl)
  console.log('\n\n=== INDEXED via HTML link discovery (not in sources.json directly) ===');
  const discovered = [...indexedUrls].filter((u) => !sourceUrls.has(u)).sort();
  if (discovered.length === 0) {
    console.log('(none)');
  } else {
    console.log(`  ${discovered.length} URLs found by the crawler following HTML links (OK, adds coverage)`);
    for (const u of discovered.slice(0, 10)) console.log(`  - ${u}`);
    if (discovered.length > 10) console.log(`  ... y ${discovered.length - 10} más`);
  }

  // Report 4: superseded manual versions — informational only
  console.log('\n\n=== OLDER VERSIONS (ignored, superseded by an indexed doc) ===');
  console.log(`  ${older.length} URLs`);

  // Report 5: stats. Old versions and navigation pages don't count against coverage.
  const relevant = [...liveUrls].filter((u) => !IGNORED_URLS.has(u) && !older.includes(u));
  console.log('\n\n=== Stats ===');
  console.log(`  AFIP live URLs (index pages):      ${liveUrls.size}`);
  console.log(`  ... excl. old versions / nav:      ${relevant.length}`);
  console.log(`  sources.json URLs:                 ${sourceUrls.size}`);
  console.log(`  Actually indexed in DB:            ${indexedUrls.size}`);
  console.log(`  Coverage (relevant ∩ indexed):     ${((relevant.filter((u) => indexedUrls.has(u)).length / relevant.length) * 100).toFixed(1)}%`);

  if (missing.length > 0 || newer.length > 0 || notIndexed.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Report failed:', err);
  process.exit(1);
});
