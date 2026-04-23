import { z } from 'zod';
import { embedQuery } from '../services/embedder.js';
import { searchDocs } from '../services/vector-store.js';
import { escapeBoundary, escapeXmlAttr, UNTRUSTED_CONTENT_NOTICE } from './format.js';

export const searchDocsSchema = z.object({
  query: z.string().min(1).describe('Pregunta o término a buscar en la documentación de AFIP/ARCA'),
  wsId: z.string().optional().describe('Filtrar por web service específico (ej: "wsfev1", "wsaa", "padron")'),
  topK: z.number().int().min(1).max(20).default(8).describe('Cantidad de resultados a devolver. Default 8.'),
});

export type SearchDocsInput = z.infer<typeof searchDocsSchema>;

export async function handleSearchDocs(input: SearchDocsInput) {
  const { query, wsId, topK } = input;
  const embedding = await embedQuery(query);
  const results = searchDocs(embedding, query, wsId, topK);

  if (results.length === 0) {
    return {
      content: [{ type: 'text' as const, text: 'No se encontraron resultados para la consulta.' }],
    };
  }

  // Wrap each chunk in <afip_doc> delimiter with escaped attributes and content
  // so the consuming LLM can structurally distinguish reference material from
  // user instructions — mitigation for indirect prompt injection.
  const formatted = results.map((r, i) => {
    const attrs = [
      `index="${i + 1}"`,
      `ws_id="${escapeXmlAttr(r.wsId)}"`,
      r.section ? `section="${escapeXmlAttr(r.section)}"` : '',
      `source="${escapeXmlAttr(r.source)}"`,
      r.distance ? `similarity="${(1 - r.distance).toFixed(3)}"` : '',
    ]
      .filter(Boolean)
      .join(' ');
    const safeText = escapeBoundary(r.text, 'afip_doc');
    return `<afip_doc ${attrs}>\n${safeText}\n</afip_doc>`;
  });

  const uniqueSources = [...new Set(results.map((r) => r.source))];
  const hint =
    `Si los fragmentos están truncados o no traen el schema completo, llamá a ` +
    `\`get_document\` con una de estas URLs (en orden de relevancia):\n` +
    uniqueSources.slice(0, 3).map((s) => `- ${s}`).join('\n');

  const text = [UNTRUSTED_CONTENT_NOTICE, '', ...formatted, '', hint].join('\n');

  return {
    content: [{ type: 'text' as const, text }],
  };
}
