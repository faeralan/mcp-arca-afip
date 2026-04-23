import { z } from 'zod';
import { getWebService } from '../services/vector-store.js';

export const getWebServiceSchema = z.object({
  wsId: z.string().min(1).describe('ID del web service (ej: "wsfev1", "wsaa", "padron")'),
});

export type GetWebServiceInput = z.infer<typeof getWebServiceSchema>;

export function handleGetWebService(input: GetWebServiceInput) {
  const detail = getWebService(input.wsId);

  if (!detail) {
    return {
      content: [{ type: 'text' as const, text: `Web service "${input.wsId}" no encontrado. Usá list_web_services para ver los disponibles.` }],
    };
  }

  const urlList = detail.sourceUrls.map((u) => `- ${u}`).join('\n');
  const sectionList = detail.sections
    .map((s) => `- ${[s.title, s.section].filter(Boolean).join(' › ') || '(sin título)'}`)
    .join('\n');

  return {
    content: [
      {
        type: 'text' as const,
        text: [
          `# ${detail.name} (\`${detail.wsId}\`)`,
          detail.description ? `\n${detail.description}` : '',
          `\n## Fuentes\n${urlList}`,
          `\n## Secciones indexadas\n${sectionList}`,
        ].join('\n'),
      },
    ],
  };
}
