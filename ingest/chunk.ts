import type { ParsedDoc } from './parse.js';

export interface TextChunk {
  wsId: string;
  source: string;
  title: string | null;
  section: string | null;
  text: string;
}

const MAX_CHARS = 1800; // ~450 tokens @ ~4 chars/token
const OVERLAP_CHARS = 200;

function splitText(text: string): string[] {
  if (text.length <= MAX_CHARS) return [text];

  const chunks: string[] = [];
  const separators = ['\n\n', '\n', '. ', ' '];

  function splitAt(str: string, sep: string): string[] {
    return str.split(sep).reduce<string[]>((acc, part) => {
      if (!acc.length) return [part];
      const last = acc[acc.length - 1];
      if ((last + sep + part).length <= MAX_CHARS) {
        acc[acc.length - 1] = last + sep + part;
      } else {
        acc.push(part);
      }
      return acc;
    }, []);
  }

  let parts = [text];
  for (const sep of separators) {
    const newParts: string[] = [];
    for (const part of parts) {
      if (part.length <= MAX_CHARS) {
        newParts.push(part);
      } else {
        newParts.push(...splitAt(part, sep));
      }
    }
    parts = newParts;
    if (parts.every((p) => p.length <= MAX_CHARS)) break;
  }

  // Add overlap between consecutive chunks
  for (let i = 0; i < parts.length; i++) {
    if (i > 0 && parts[i].length < MAX_CHARS - OVERLAP_CHARS) {
      const overlap = parts[i - 1].slice(-OVERLAP_CHARS);
      chunks.push(overlap + ' ' + parts[i]);
    } else {
      chunks.push(parts[i]);
    }
  }

  return chunks;
}

export function chunkDoc(doc: ParsedDoc): TextChunk[] {
  const chunks: TextChunk[] = [];

  for (const section of doc.sections) {
    const combined = [section.heading, section.text].filter(Boolean).join('\n\n');
    if (!combined.trim()) continue;

    for (const text of splitText(combined)) {
      if (text.trim().length < 50) continue; // skip trivial chunks
      chunks.push({
        wsId: doc.wsId,
        source: doc.source,
        title: doc.title,
        section: section.heading,
        text: text.trim(),
      });
    }
  }

  return chunks;
}
