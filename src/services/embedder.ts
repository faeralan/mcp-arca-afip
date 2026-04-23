import { pipeline, env, type FeatureExtractionPipeline } from '@huggingface/transformers';
import path from 'path';
import os from 'os';

// Persist the embedding model in a stable per-user cache. By default transformers.js
// v4 caches inside node_modules/@huggingface/transformers/.cache, which lives in the
// npx sandbox — each `npx -y ...@latest` invocation could otherwise re-download
// ~120 MB. Pointing at ~/.cache/mcp-arca-afip/models survives sandbox rotation.
env.cacheDir = path.join(os.homedir(), '.cache', 'mcp-arca-afip', 'models');

// Silence library progress/info output. We run as a stdio MCP server where stdout
// is the JSON-RPC channel — any stray log would corrupt the protocol and the client
// would drop the connection during the one-time model download.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(env as any).logLevel = 'error';

const MODEL = 'Xenova/multilingual-e5-small';

let instance: FeatureExtractionPipeline | null = null;

async function getEmbedder(): Promise<FeatureExtractionPipeline> {
  if (!instance) {
    instance = await pipeline('feature-extraction', MODEL, { dtype: 'q8' });
  }
  return instance;
}

export async function embedQuery(text: string): Promise<number[]> {
  const embedder = await getEmbedder();
  const output = await embedder(`query: ${text}`, { pooling: 'mean', normalize: true });
  return Array.from(output.data as Float32Array);
}

export async function embedPassages(texts: string[]): Promise<number[][]> {
  const embedder = await getEmbedder();
  const results: number[][] = [];
  const BATCH = 32;
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH).map((t) => `passage: ${t}`);
    const output = await embedder(batch, { pooling: 'mean', normalize: true });
    const dims = output.dims[1] as number;
    for (let j = 0; j < batch.length; j++) {
      results.push(Array.from((output.data as Float32Array).slice(j * dims, (j + 1) * dims)));
    }
  }
  return results;
}
