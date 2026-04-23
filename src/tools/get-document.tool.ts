import { z } from 'zod';
import { getDocumentChunks } from '../services/vector-store.js';
import { escapeBoundary, escapeXmlAttr, UNTRUSTED_CONTENT_NOTICE } from './format.js';

export const getDocumentSchema = z.object({
  source: z
    .string()
    .url()
    .describe('URL exacta del documento (el campo `source` devuelto por search_docs)'),
  maxChars: z
    .number()
    .int()
    .min(1000)
    .max(120000)
    .default(60000)
    .describe('Máximo de caracteres a devolver. Default 60k (~15k tokens).'),
});

export type GetDocumentInput = z.infer<typeof getDocumentSchema>;

export function handleGetDocument(input: GetDocumentInput) {
  const chunks = getDocumentChunks(input.source, input.maxChars);

  if (chunks.length === 0) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Documento "${input.source}" no indexado. Usá search_docs para encontrar URLs válidas.`,
        },
      ],
    };
  }

  // Reconstruct the document body with inline section markers
  const sections: string[] = [];
  let lastSection: string | null = null;
  for (const chunk of chunks) {
    if (chunk.section && chunk.section !== lastSection) {
      sections.push(`\n## ${chunk.section}\n`);
      lastSection = chunk.section;
    }
    sections.push(chunk.text);
  }
  const body = escapeBoundary(sections.join('\n\n').trim(), 'afip_doc');

  const title = chunks[0].title ?? '';
  const attrs = [
    `source="${escapeXmlAttr(input.source)}"`,
    title ? `title="${escapeXmlAttr(title)}"` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const text = [
    UNTRUSTED_CONTENT_NOTICE,
    '',
    `<afip_doc ${attrs}>`,
    body,
    `</afip_doc>`,
  ].join('\n');

  return {
    content: [{ type: 'text' as const, text }],
  };
}
