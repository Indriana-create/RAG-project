import { chunkDocument } from '../../domain/chunk.js';

/** Memuat dokumen, memecahnya menjadi chunk, lalu mengindeksnya. */
export class IngestKnowledge {
  constructor({ documentSource, retriever }) {
    this.documentSource = documentSource;
    this.retriever = retriever;
  }

  async execute() {
    const documents = await this.documentSource.loadAll();
    const chunks = documents.flatMap((d) => chunkDocument(d));
    await this.retriever.index(chunks);
    return { documents: documents.length, chunks: chunks.length };
  }
}
