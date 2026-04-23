export interface Chunk {
  id: number;
  wsId: string;
  source: string;
  title: string | null;
  section: string | null;
  text: string;
}

export interface SearchResult extends Chunk {
  distance: number;
}

export interface WebService {
  wsId: string;
  name: string;
  description: string | null;
  sourceUrls: string[];
}

export interface WebServiceDetail extends WebService {
  sections: Array<{ title: string | null; section: string | null }>;
}
