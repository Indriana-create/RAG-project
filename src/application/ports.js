/**
 * Port (kontrak) yang dibutuhkan layer application.
 * Implementasinya hidup di layer infrastructure — dependensi selalu mengarah ke dalam.
 *
 * @typedef {import('../domain/knowledge-document.js').KnowledgeDocument} KnowledgeDocument
 * @typedef {import('../domain/chunk.js').Chunk} Chunk
 *
 * @typedef {Object} DocumentSource
 * @property {() => Promise<KnowledgeDocument[]>} loadAll
 *
 * @typedef {Object} KnowledgeRepository
 * @property {() => Promise<KnowledgeDocument[]>} list
 * @property {(id: string) => Promise<KnowledgeDocument|undefined>} get
 * @property {(doc: KnowledgeDocument) => Promise<void>} save
 * @property {(id: string) => Promise<boolean>} delete
 *
 * @typedef {Object} Retriever
 * @property {(chunks: Chunk[]) => Promise<void>} index
 * @property {(query: string, topK: number) => Promise<Array<{chunk: Chunk, score: number}>>} search
 *
 * @typedef {Object} AnswerGenerator
 * @property {(input: {question: string, contexts: Chunk[], history: Array<{role:string,content:string}>}) => Promise<string>} generate
 *
 * @typedef {Object} ChatHistoryRepository
 * @property {(sessionId: string, message: object) => Promise<void>} append
 * @property {(sessionId: string) => Promise<object[]>} list
 * @property {(sessionId: string) => Promise<void>} clear
 */
export {};
