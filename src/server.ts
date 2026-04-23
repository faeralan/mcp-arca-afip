import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { handleSearchDocs, searchDocsSchema } from './tools/search-docs.tool.js';
import { handleListWebServices } from './tools/list-web-services.tool.js';
import { handleGetWebService, getWebServiceSchema } from './tools/get-web-service.tool.js';
import { handleGetDocument, getDocumentSchema } from './tools/get-document.tool.js';

export function registerTools(server: Server): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'search_docs',
        description:
          'PRIMER PASO para cualquier consulta sobre AFIP/ARCA. Búsqueda semántica que devuelve 8 ' +
          'fragmentos relevantes con su URL fuente. Ideal para localizar: códigos de error, nombres ' +
          'de campos, reglas de validación, ejemplos. ' +
          'Si los fragmentos están truncados o no traen el schema/respuesta completa, ' +
          'LLAMÁ A get_document con la URL fuente que aparece en los resultados.',
        inputSchema: zodToJsonSchema(searchDocsSchema),
      },
      {
        name: 'list_web_services',
        description:
          'Lista todos los web services AFIP/ARCA indexados con su ID y descripción. ' +
          'Usá este tool primero para saber qué wsId pasarle a search_docs o get_web_service.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'get_web_service',
        description:
          'Devuelve metadatos y tabla de contenidos de un web service específico: ' +
          'nombre completo, URLs oficiales y secciones indexadas.',
        inputSchema: zodToJsonSchema(getWebServiceSchema),
      },
      {
        name: 'get_document',
        description:
          'SEGUNDO PASO cuando search_docs no trae suficiente detalle. ' +
          'Devuelve el manual PDF completo reconstruido (hasta ~60k chars, equivalente a ~15k tokens). ' +
          'USÁ ESTO en vez de fallback a fetch/WebFetch del PDF directo cuando necesites: ' +
          'schema XML completo de response/request, tabla de códigos de error entera, ' +
          'lista completa de métodos de un WS, o cualquier detalle no-truncado. ' +
          'Input: la URL exacta que aparece como `source` en los resultados de search_docs.',
        inputSchema: zodToJsonSchema(getDocumentSchema),
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    switch (name) {
      case 'search_docs':
        return handleSearchDocs(searchDocsSchema.parse(args));

      case 'list_web_services':
        return handleListWebServices();

      case 'get_web_service':
        return handleGetWebService(getWebServiceSchema.parse(args));

      case 'get_document':
        return handleGetDocument(getDocumentSchema.parse(args));

      default:
        throw new Error(`Tool desconocido: ${name}`);
    }
  });
}
