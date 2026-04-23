/**
 * Smoke tests — require a built index.db in data/
 * Run: npm test
 */
import { listWebServices, getWebService, searchDocs, getDocumentChunks } from '../src/services/vector-store.js';
import { embedQuery } from '../src/services/embedder.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (condition) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.error(`  ✗ ${msg}`);
    failed++;
  }
}

async function run(): Promise<void> {
  console.log('=== mcp-arca-afip smoke tests ===\n');

  // list_web_services
  console.log('list_web_services:');
  const services = listWebServices();
  assert(services.length >= 40, `At least 40 WS indexed (got ${services.length})`);
  const ids = services.map((s) => s.wsId);
  assert(ids.includes('wsfev1'), 'wsfev1 is indexed');
  assert(ids.includes('wsaa'), 'wsaa is indexed');
  assert(ids.includes('ws_sr_padron_a13'), 'ws_sr_padron_a13 is indexed');
  assert(ids.includes('wscpe'), 'wscpe is indexed');
  assert(ids.includes('wslpg'), 'wslpg is indexed');

  // get_web_service
  console.log('\nget_web_service(wsfev1):');
  const detail = getWebService('wsfev1');
  assert(detail !== null, 'wsfev1 detail returned');
  assert((detail?.sections.length ?? 0) > 0, 'wsfev1 has sections');

  console.log('\nget_web_service(nonexistent):');
  assert(getWebService('nonexistent') === null, 'nonexistent returns null');

  // search_docs — invoicing
  console.log('\nsearch_docs("cómo autorizar factura B"):');
  const q1str = 'cómo autorizar factura B';
  const q1 = await embedQuery(q1str);
  const r1 = searchDocs(q1, q1str, undefined, 5);
  assert(r1.length > 0, `Returns results (got ${r1.length})`);
  assert(
    r1.some((r) => r.wsId === 'wsfev1'),
    'Top results include wsfev1'
  );

  // search_docs — auth filtered by wsId
  console.log('\nsearch_docs("ticket de acceso", wsId=wsaa):');
  const q2str = 'ticket de acceso';
  const q2 = await embedQuery(q2str);
  const r2 = searchDocs(q2, q2str, 'wsaa', 5);
  assert(r2.length > 0, `Returns results when filtered by wsaa (got ${r2.length})`);
  assert(
    r2.every((r) => r.wsId === 'wsaa'),
    'All results are from wsaa'
  );

  // search_docs — padrón lookup
  console.log('\nsearch_docs("consultar CUIT contribuyente"):');
  const q3str = 'consultar CUIT contribuyente';
  const q3 = await embedQuery(q3str);
  const r3 = searchDocs(q3, q3str, undefined, 5);
  assert(r3.length > 0, `Returns results (got ${r3.length})`);
  assert(
    r3.some((r) => r.wsId.startsWith('ws_sr_padron') || r.wsId === 'ws_sr_constancia_inscripcion'),
    'Top results include a padrón WS'
  );

  // search_docs — carta de porte
  console.log('\nsearch_docs("carta de porte granos"):');
  const q4str = 'carta de porte granos';
  const q4 = await embedQuery(q4str);
  const r4 = searchDocs(q4, q4str, undefined, 3);
  assert(r4.length > 0, `Returns results (got ${r4.length})`);

  // Hybrid search — keyword query that should be found via FTS5 (exact-match for operation name)
  console.log('\nsearch_docs("FECAESolicitar") — hybrid BM25:');
  const q5str = 'FECAESolicitar';
  const q5 = await embedQuery(q5str);
  const r5 = searchDocs(q5, q5str, undefined, 5);
  assert(r5.length > 0, `Returns results (got ${r5.length})`);
  assert(
    r5.some((r) => /FECAESolicitar/i.test(r.text)),
    'At least one result contains the literal "FECAESolicitar" (FTS match)'
  );

  // Hybrid search — numeric code lookup (pure semantic would miss this)
  console.log('\nsearch_docs("getPersona") — WSDL operation lookup:');
  const q6str = 'getPersona';
  const q6 = await embedQuery(q6str);
  const r6 = searchDocs(q6, q6str, undefined, 5);
  assert(r6.length > 0, `Returns results (got ${r6.length})`);
  assert(
    r6.some((r) => /getPersona/i.test(r.text)),
    'At least one result contains the literal "getPersona"'
  );

  // WSDL indexed — search finds WSDL chunks via unique operation name (only in WSDL, not PDF)
  console.log('\nsearch_docs("getIdPersonaListByDocumento"):');
  const q7str = 'getIdPersonaListByDocumento';
  const q7 = await embedQuery(q7str);
  const r7 = searchDocs(q7, q7str, undefined, 5);
  assert(r7.length > 0, `Returns results (got ${r7.length})`);
  assert(
    r7.some((r) => r.source.toLowerCase().includes('wsdl')),
    'At least one result comes from a WSDL source'
  );

  // get_document — full content by source URL
  console.log('\nget_document(source from search result):');
  const srcUrl = r1[0].source;
  const docChunks = getDocumentChunks(srcUrl, 60000);
  assert(docChunks.length > 0, `Returns chunks for source (got ${docChunks.length})`);
  const totalChars = docChunks.reduce((sum, c) => sum + c.text.length, 0);
  assert(totalChars > r1[0].text.length, `Full doc (${totalChars} chars) is larger than single chunk`);

  console.log('\nget_document(nonexistent source):');
  const noChunks = getDocumentChunks('https://example.com/fake.pdf', 60000);
  assert(noChunks.length === 0, 'Unknown source returns empty');

  // Summary
  console.log(`\n--- ${passed} passed, ${failed} failed ---`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Test run failed:', err);
  process.exit(1);
});
