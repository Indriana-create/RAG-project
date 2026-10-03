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
 * @typedef {import('../domain/admin-user.js').AdminUser} AdminUser
 *
 * @typedef {Object} AdminUserRepository
 * @property {() => Promise<AdminUser[]>} list
 * @property {(id: string) => Promise<AdminUser|undefined>} get
 * @property {(username: string) => Promise<AdminUser|undefined>} getByUsername
 * @property {(user: AdminUser) => Promise<void>} save lempar ConflictError bila username sudah dipakai akun lain
 * @property {(id: string) => Promise<boolean>} delete
 *
 * @typedef {Object} PasswordHasher
 * @property {(password: string) => Promise<string>} hash
 * @property {(password: string, hash: string) => Promise<boolean>} verify
 *
 * @typedef {Object} SessionTokens
 * @property {(claims: {userId: string, version: number}) => string} issue
 * @property {(token: string) => ({userId: string, version: number}|null)} verify
 * @property {number} ttlSeconds
 *
 * @typedef {Object} LoginThrottle
 * @property {(keys: string[]) => number} retryAfter detik sampai boleh mencoba lagi (0 = boleh)
 * @property {(keys: string[]) => void} recordFailure
 * @property {(keys: string[]) => void} reset
 *
 * @typedef {Object} Retriever
 * @property {(chunks: Chunk[]) => Promise<void>} index
 * @property {(query: string, topK: number, options?: {signal?: AbortSignal}) => Promise<Array<{chunk: Chunk, score: number}>>} search
 *
 * @typedef {Object} Embedder
 * @property {(texts: string[], options?: {signal?: AbortSignal}) => Promise<number[][]>} embed
 *
 * @typedef {Object} AnswerGenerator
 * @property {(input: {question: string, contexts: Chunk[], history: Array<{role:string,content:string}>, signal?: AbortSignal}) => Promise<string>} generate
 * @property {(input: {question: string, contexts: Chunk[], history: Array<{role:string,content:string}>, signal?: AbortSignal}) => AsyncIterable<string>} [stream] opsional: token demi token
 *
 * @typedef {Object} ChatHistoryRepository
 * @property {(sessionId: string, message: object) => Promise<void>} append
 * @property {(sessionId: string) => Promise<object[]>} list
 * @property {(sessionId: string) => Promise<void>} clear
 */
export {};
