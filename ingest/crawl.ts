import { fetch } from 'undici';
import { load } from 'cheerio';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '.cache');
const UA = 'mcp-arca-afip/0.1.0 (+https://github.com/alanfaer/mcp-arca-afip)';
const RATE_LIMIT_MS = 1200;

export interface DownloadedDoc {
  wsId: string;
  url: string;
  type: 'html' | 'pdf' | 'wsdl';
  content: Buffer;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function urlToFilename(url: string): string {
  return url.replace(/[^a-z0-9]/gi, '_').slice(0, 200);
}

async function cachedFetch(url: string): Promise<Buffer> {
  await mkdir(CACHE_DIR, { recursive: true });
  const cachePath = path.join(CACHE_DIR, urlToFilename(url));

  if (existsSync(cachePath)) {
    return readFile(cachePath);
  }

  await sleep(RATE_LIMIT_MS);
  console.log(`  Downloading: ${url}`);

  const res = await fetch(url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(cachePath, buf);
  return buf;
}

function detectType(url: string, content: Buffer): 'html' | 'pdf' | 'wsdl' {
  const lower = url.toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.includes('wsdl') || lower.endsWith('.wsdl') || lower.includes('.asmx?wsdl')) return 'wsdl';

  // Fallback: sniff the body. WSDLs are XML with a wsdl: prefix or xmlns:wsdl declaration.
  const head = content.slice(0, 2048).toString('utf-8');
  if (/^\s*<\?xml/.test(head) && /(<wsdl:|xmlns:wsdl=)/i.test(head)) return 'wsdl';

  return 'html';
}

export async function crawlSources(
  sources: Record<string, { name: string; description: string; entrypoints: string[] }>
): Promise<DownloadedDoc[]> {
  const docs: DownloadedDoc[] = [];

  for (const [wsId, ws] of Object.entries(sources)) {
    console.log(`\nCrawling: ${ws.name} (${wsId})`);

    for (const url of ws.entrypoints) {
      try {
        const content = await cachedFetch(url);
        const type = detectType(url, content);

        docs.push({ wsId, url, type, content });

        // For HTML pages, discover linked PDF/WSDL docs on the same page
        if (type === 'html') {
          const $ = load(content.toString('utf-8'));
          const linkedUrls: string[] = [];

          $('a[href]').each((_, el) => {
            const href = $(el).attr('href') ?? '';
            if (href.endsWith('.pdf') || href.toLowerCase().includes('wsdl') || href.endsWith('.wsdl')) {
              const resolved = href.startsWith('http') ? href : new URL(href, url).href;
              // Only follow links from the same domain
              if (resolved.includes('afip.gob.ar') || resolved.includes('servicios1.afip')) {
                linkedUrls.push(resolved);
              }
            }
          });

          for (const linkedUrl of linkedUrls.slice(0, 10)) { // cap per page
            try {
              const linkedContent = await cachedFetch(linkedUrl);
              const linkedType = detectType(linkedUrl, linkedContent);
              docs.push({ wsId, url: linkedUrl, type: linkedType, content: linkedContent });
            } catch (err) {
              console.warn(`    Skipped ${linkedUrl}: ${(err as Error).message}`);
            }
          }
        }
      } catch (err) {
        console.warn(`  Skipped ${url}: ${(err as Error).message}`);
      }
    }
  }

  return docs;
}
