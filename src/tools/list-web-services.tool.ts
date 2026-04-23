import { listWebServices } from '../services/vector-store.js';

export function handleListWebServices() {
  const services = listWebServices();

  if (services.length === 0) {
    return {
      content: [{ type: 'text' as const, text: 'No hay web services indexados. Ejecutá el pipeline de ingesta.' }],
    };
  }

  const lines = services.map((s) => `- **${s.wsId}** — ${s.name}${s.description ? `\n  ${s.description}` : ''}`);
  return {
    content: [{ type: 'text' as const, text: `# Web Services AFIP/ARCA indexados\n\n${lines.join('\n')}` }],
  };
}
