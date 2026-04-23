import { load } from 'cheerio';
import type { DownloadedDoc } from './crawl.js';

export interface ParsedDoc {
  wsId: string;
  source: string;
  title: string | null;
  sections: Array<{ heading: string | null; text: string }>;
}

// Strip residual Sphinx/Bootstrap navigation text that survives tag removal.
// These patterns match whole lines that are pure boilerplate — line-based so we don't
// accidentally destroy content that happens to contain the phrase.
const SPHINX_LINE_PATTERNS: RegExp[] = [
  /^Navegación(\s|$)/i,
  /^Tema anterior\b/i,
  /^Próximo tema\b/i,
  /^Tabla de Contenidos\b/i,
  /^Búsqueda rápida\b/i,
  /^Introduzca los términos\b/i,
  /^(siguiente|anterior)\s*$/i,
  /^«\s/,
  /^»\s/,
  /^WSASS - MANUAL DEL USUARIO\s*»?\s*$/i,
];

function stripSphinxBoilerplate(text: string): string {
  return text
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      return !SPHINX_LINE_PATTERNS.some((re) => re.test(trimmed));
    })
    .join('\n');
}

// HTML → structured sections
function parseHtml(content: Buffer, url: string, wsId: string): ParsedDoc {
  const $ = load(content.toString('utf-8'));
  const title = $('title').first().text().trim() || $('h1').first().text().trim() || null;

  // Remove noise — tag-based + class/id-based. Covers generic sites, Bootstrap, and Sphinx.
  $(
    [
      'nav', 'header', 'footer', 'script', 'style',
      '.menu', '.breadcrumb', '.breadcrumbs',
      '.sphinxsidebar', '.related', '.document-nav', '.navbar',
      'div[role="navigation"]',
      '#header', '#footer', '#nav', '#searchbox', '#top', '#bottom', '#sidebar',
    ].join(', ')
  ).remove();

  // Convert tables to Markdown
  $('table').each((_, table) => {
    const rows: string[][] = [];
    $(table).find('tr').each((_, tr) => {
      const cells = $(tr).find('td, th').map((_, td) => $(td).text().trim().replace(/\s+/g, ' ')).get();
      rows.push(cells);
    });
    if (rows.length === 0) return;
    const header = `| ${rows[0].join(' | ')} |`;
    const sep = `| ${rows[0].map(() => '---').join(' | ')} |`;
    const body = rows.slice(1).map((r) => `| ${r.join(' | ')} |`).join('\n');
    $(table).replaceWith(`\n\n${header}\n${sep}\n${body}\n\n`);
  });

  const sections: Array<{ heading: string | null; text: string }> = [];
  const main = $('main, article, .content, #content, body').first();
  let currentHeading: string | null = null;
  let currentText = '';

  const pushSection = () => {
    const cleaned = stripSphinxBoilerplate(currentText).trim();
    if (cleaned) {
      sections.push({ heading: currentHeading, text: cleaned });
    }
  };

  main.children().each((_, el) => {
    const tag = (el as any).tagName?.toLowerCase() ?? '';
    if (['h1', 'h2', 'h3', 'h4'].includes(tag)) {
      pushSection();
      currentHeading = $(el).text().trim();
      currentText = '';
    } else {
      currentText += '\n' + $(el).text().replace(/\s+/g, ' ').trim();
    }
  });

  pushSection();

  if (sections.length === 0) {
    const fallback = stripSphinxBoilerplate(main.text().replace(/\s+/g, ' ').trim());
    sections.push({ heading: null, text: fallback });
  }

  return { wsId, source: url, title, sections };
}

// WSDL → list of operations and types
function parseWsdl(content: Buffer, url: string, wsId: string): ParsedDoc {
  const raw = content.toString('utf-8');

  // Cheerio xmlMode strips namespace prefixes when using tag selectors, but real WSDLs
  // from AFIP use <wsdl:operation>, <xsd:complexType>, etc. Match by local-name via
  // regex on raw XML — simpler and robust across prefix conventions.
  const extractNames = (pattern: RegExp): string[] => {
    const names = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(raw)) !== null) {
      if (m[1]) names.add(m[1]);
    }
    return [...names];
  };

  // Element local-names — `\b` handles optional namespace prefix (wsdl:, xsd:, xs:, etc.)
  const operations = extractNames(/<(?:[a-zA-Z][\w-]*:)?operation\s+[^>]*\bname\s*=\s*["']([^"']+)["']/g);
  const complexTypes = extractNames(/<(?:[a-zA-Z][\w-]*:)?complexType\s+[^>]*\bname\s*=\s*["']([^"']+)["']/g);
  const elements = extractNames(/<(?:[a-zA-Z][\w-]*:)?element\s+[^>]*\bname\s*=\s*["']([^"']+)["']/g);
  const messages = extractNames(/<(?:[a-zA-Z][\w-]*:)?message\s+[^>]*\bname\s*=\s*["']([^"']+)["']/g);

  const allTypes = [...new Set([...complexTypes, ...elements])];

  const text = [
    operations.length > 0
      ? `Operaciones disponibles:\n${operations.map((o) => `- ${o}`).join('\n')}`
      : '',
    messages.length > 0
      ? `\nMensajes SOAP:\n${messages.map((m) => `- ${m}`).join('\n')}`
      : '',
    allTypes.length > 0
      ? `\nTipos de datos (elements + complexTypes):\n${allTypes.map((t) => `- ${t}`).join('\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    wsId,
    source: url,
    title: `WSDL — ${wsId}`,
    sections: [{ heading: 'Operaciones y Tipos', text }],
  };
}

// PDF → sections (using basic text extraction without pdfjs-dist worker issues)
async function parsePdf(content: Buffer, url: string, wsId: string): Promise<ParsedDoc> {
  // Dynamically import pdfjs-dist to avoid top-level ESM issues
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

  // Configure worker for Node.js — point GlobalWorkerOptions at the worker module
  if (!(pdfjsLib as any).GlobalWorkerOptions.workerSrc) {
    const { createRequire } = await import('module');
    const require = createRequire(import.meta.url);
    (pdfjsLib as any).GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
  }

  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(content),
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
    disableFontFace: true,
  });
  const pdfDoc = await loadingTask.promise;

  const pages: string[] = [];
  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .filter((item): item is any => 'str' in item)
      .map((item: any) => item.str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (pageText) pages.push(pageText);
  }

  // Detect repeated header/footer lines (appear in >50% of pages).
  // Only meaningful when pages have multiple actual newlines — pdfjs-dist usually
  // joins all text items with spaces, producing single-line pages that would
  // accidentally be flagged as "repeated noise" and wipe the entire content.
  const avgLinesPerPage = pages.length > 0
    ? pages.reduce((s, p) => s + p.split('\n').length, 0) / pages.length
    : 0;

  let noise: Set<string>;
  if (avgLinesPerPage >= 3) {
    const lineFreq: Map<string, number> = new Map();
    for (const page of pages) {
      const lines = page.split('\n').slice(0, 3).concat(page.split('\n').slice(-3));
      for (const line of lines) {
        if (line.trim().length > 5) {
          lineFreq.set(line.trim(), (lineFreq.get(line.trim()) ?? 0) + 1);
        }
      }
    }
    noise = new Set([...lineFreq.entries()].filter(([, c]) => c > pages.length * 0.5).map(([l]) => l));
  } else {
    noise = new Set<string>();
  }

  const cleanedText = pages
    .map((p) => p.split('\n').filter((l) => !noise.has(l.trim())).join('\n'))
    .join('\n\n--- página ---\n\n');

  // Split into rough sections by detecting heading-like lines (ALL CAPS or short + followed by content)
  const sections: Array<{ heading: string | null; text: string }> = [];
  let currentHeading: string | null = null;
  let buffer = '';

  for (const line of cleanedText.split('\n')) {
    const trimmed = line.trim();
    const isHeading = trimmed.length > 0 && trimmed.length < 80 && trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed);
    if (isHeading) {
      if (buffer.trim()) sections.push({ heading: currentHeading, text: buffer.trim() });
      currentHeading = trimmed;
      buffer = '';
    } else {
      buffer += ' ' + trimmed;
    }
  }
  if (buffer.trim()) sections.push({ heading: currentHeading, text: buffer.trim() });

  return {
    wsId,
    source: url,
    title: `Manual PDF — ${wsId}`,
    sections: sections.length > 0 ? sections : [{ heading: null, text: cleanedText }],
  };
}

export async function parseDoc(doc: DownloadedDoc): Promise<ParsedDoc> {
  switch (doc.type) {
    case 'html':
      return parseHtml(doc.content, doc.url, doc.wsId);
    case 'wsdl':
      return parseWsdl(doc.content, doc.url, doc.wsId);
    case 'pdf':
      return parsePdf(doc.content, doc.url, doc.wsId);
  }
}
