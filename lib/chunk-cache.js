/**
 * In-memory cache for book_chunks documents.
 *
 * Next.js API routes share module-level state within the same server process,
 * so this cache is shared across query.js and books.js — eliminating redundant
 * Firestore reads and drastically reducing quota consumption.
 *
 * TTL: 10 minutes. Automatically invalidated after upload or book deletion.
 */

let _cache = null;
let _cacheTs = 0;
const TTL_MS = 60 * 60 * 1000; // 60 minutes (safety backstop — cache is also busted on upload/delete)

/**
 * Returns all book_chunks from cache, or fetches from Firestore and caches.
 * NOTE: returns full documents including embedding vectors — filter by profile after.
 * @param {FirebaseFirestore.Firestore} db
 */
export async function getCachedChunks(db) {
  const now = Date.now();
  if (_cache && (now - _cacheTs) < TTL_MS) {
    return _cache;
  }
  const snap = await db.collection('book_chunks').get();
  _cache = snap.docs.map(d => d.data());
  _cacheTs = now;
  return _cache;
}

/**
 * Force-expire the cache. Call after any upload or delete so the next
 * query re-fetches fresh data from Firestore.
 */
export function invalidateChunkCache() {
  _cache = null;
  _cacheTs = 0;
}
