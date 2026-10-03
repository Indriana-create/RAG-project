import { chunkDocument } from '../../domain/chunk.js';

/** Membangun ulang indeks pencarian dari dokumen yang AKTIF saja. */
export class ReindexKnowledge {
  constructor({ repository, retriever }) {
    this.repository = repository;
    this.retriever = retriever;
  }

  async execute() {
    const documents = (await this.repository.list()).filter((d) => d.enabled);
    const chunks = documents.flatMap((d) => chunkDocument(d));
    await this.retriever.index(chunks);
    return { documents: documents.length, chunks: chunks.length };
  }
}
