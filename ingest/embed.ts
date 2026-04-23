import { embedPassages } from '../src/services/embedder.js';
import { createHash } from 'crypto';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { TextChunk } from './chunk.js';

export interface EmbeddedChunk extends TextChunk {
  embedding: number[];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = path.join(__dirname, '.cache', 'embeddings.json');

type CacheMap = Record<string, number[]>;

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex').substring(0, 24);
}

async function loadCache(): Promise<CacheMap> {
  if (!existsSync(CACHE_FILE)) return {};
  try {
    return JSON.parse(await readFile(CACHE_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

async function saveCache(cache: CacheMap): Promise<void> {
  await mkdir(path.dirname(CACHE_FILE), { recursive: true });
  await writeFile(CACHE_FILE, JSON.stringify(cache));
}

export async function embedChunks(chunks: TextChunk[]): Promise<EmbeddedChunk[]> {
  console.log(`\nEmbedding ${chunks.length} chunks...`);
  const cache = await loadCache();
  const result: EmbeddedChunk[] = new Array(chunks.length);

  // Separate cached from uncached
  const uncached: Array<{ index: number; chunk: TextChunk; hash: string }> = [];
  let cacheHits = 0;
  for (let i = 0; i < chunks.length; i++) {
    const hash = hashText(chunks[i].text);
    const cached = cache[hash];
    if (cached) {
      result[i] = { ...chunks[i], embedding: cached };
      cacheHits++;
    } else {
      uncached.push({ index: i, chunk: chunks[i], hash });
    }
  }

  if (cacheHits > 0) {
    console.log(`  Cache hits: ${cacheHits}/${chunks.length}`);
  }

  const BATCH = 32;
  const t0 = Date.now();
  let saveCounter = 0;

  for (let i = 0; i < uncached.length; i += BATCH) {
    const slice = uncached.slice(i, i + BATCH);
    const embeddings = await embedPassages(slice.map((u) => u.chunk.text));
    slice.forEach((u, j) => {
      result[u.index] = { ...u.chunk, embedding: embeddings[j] };
      cache[u.hash] = embeddings[j];
    });

    saveCounter += slice.length;
    if (saveCounter >= 256) {
      await saveCache(cache);
      saveCounter = 0;
    }

    const elapsed = (Date.now() - t0) / 1000;
    const done = i + slice.length;
    const rate = done / elapsed;
    const eta = Math.round((uncached.length - done) / rate);
    console.log(`  ${done}/${uncached.length} new chunks (${rate.toFixed(1)}/s, ETA ${eta}s)`);
  }

  // Final cache save
  await saveCache(cache);

  return result;
}
