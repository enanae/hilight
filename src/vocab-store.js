/**
 * Vocabulary storage backed by IndexedDB.
 * Each word entry is keyed by (language, word) and stores a knowledge level:
 *   0 = unknown (default, not stored)
 *   1 = partially known
 *   2 = known
 */

const DB_NAME = 'hilight-vocab';
const DB_VERSION = 2;
const STORE_NAME = 'words';
const LEMMA_STORE = 'lemma-cache';

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: ['language', 'word'] });
        store.createIndex('by_language', 'language', { unique: false });
        store.createIndex('by_level', ['language', 'level'], { unique: false });
      }
      if (!db.objectStoreNames.contains(LEMMA_STORE)) {
        const lstore = db.createObjectStore(LEMMA_STORE, { keyPath: ['language', 'word'] });
        lstore.createIndex('by_language', 'language', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null; // allow retry on next call
      reject(req.error);
    };
  });
  return dbPromise;
}

function tx(mode, storeName = STORE_NAME) {
  return openDB().then(db => {
    const t = db.transaction(storeName, mode);
    return t.objectStore(storeName);
  });
}

/** Wrap an IDB request in a Promise. */
function idbReq(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Get the knowledge level for a single word (0 if not stored). */
export async function getLevel(language, word) {
  const store = await tx('readonly');
  const result = await idbReq(store.get([language, word]));
  return result ? result.level : 0;
}

/** Set the knowledge level for a word. Level 0 deletes the entry. */
export async function setLevel(language, word, level) {
  const store = await tx('readwrite');
  if (level === 0) {
    await idbReq(store.delete([language, word]));
  } else {
    await idbReq(store.put({ language, word, level }));
  }
}

/**
 * Bulk-lookup: given an array of words, returns a Map<word, level>.
 * Words not in the DB are returned as level 0.
 */
export async function getLevels(language, words) {
  const store = await tx('readonly');
  const map = new Map();
  const unique = [...new Set(words)];
  await Promise.all(unique.map(async w => {
    const result = await idbReq(store.get([language, w]));
    map.set(w, result ? result.level : 0);
  }));
  return map;
}

/** Get vocabulary stats for a language. */
export async function getStats(language) {
  const store = await tx('readonly');
  const all = await idbReq(store.index('by_language').getAll(language));
  return {
    partial: all.filter(r => r.level === 1).length,
    known: all.filter(r => r.level === 2).length,
    total: all.length,
  };
}

/** Get all words + levels for a language. Returns [{word, level}, ...]. */
export async function getAllWords(language) {
  const store = await tx('readonly');
  const all = await idbReq(store.index('by_language').getAll(language));
  return all.map(r => ({ word: r.word, level: r.level }));
}

/**
 * Delete all stored words for a language.
 * Uses a single readwrite transaction to prevent interleaving.
 * Returns the deleted entries for undo: [{language, word, level}, ...]
 */
export async function deleteAllWords(language) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const txn = db.transaction(STORE_NAME, 'readwrite');
    const store = txn.objectStore(STORE_NAME);
    const req = store.index('by_language').getAll(language);
    req.onsuccess = () => {
      const entries = req.result;
      if (entries.length === 0) { resolve([]); return; }
      for (const e of entries) {
        store.delete([e.language, e.word]);
      }
      txn.oncomplete = () => resolve(entries.map(e => ({ language: e.language, word: e.word, level: e.level })));
    };
    req.onerror = () => reject(req.error);
    txn.onerror = () => reject(txn.error);
  });
}

/**
 * Delete a specific list of words for a language.
 * Uses a single readwrite transaction to prevent interleaving.
 * Returns the deleted entries that actually existed for undo.
 */
export async function deleteWordsList(language, words) {
  if (words.length === 0) return [];
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const txn = db.transaction(STORE_NAME, 'readwrite');
    const store = txn.objectStore(STORE_NAME);
    const deleted = [];
    let lookupsDone = 0;

    for (const w of words) {
      const req = store.get([language, w]);
      req.onsuccess = () => {
        if (req.result) deleted.push({ language, word: w, level: req.result.level });
        lookupsDone++;
        if (lookupsDone === words.length) {
          if (deleted.length === 0) { resolve([]); return; }
          for (const e of deleted) {
            store.delete([e.language, e.word]);
          }
          txn.oncomplete = () => resolve(deleted);
        }
      };
      req.onerror = () => reject(req.error);
    }
    txn.onerror = () => reject(txn.error);
  });
}

/** Export all vocab for a language as JSON array. */
export async function exportVocab(language) {
  const store = await tx('readonly');
  return idbReq(store.index('by_language').getAll(language));
}

/** Import vocab entries (array of {language, word, level}). Validates each entry. */
export async function importVocab(entries) {
  if (!Array.isArray(entries)) throw new Error('Expected an array');
  const valid = entries.filter(e =>
    e && typeof e.language === 'string' && typeof e.word === 'string' &&
    typeof e.level === 'number' && e.level >= 0 && e.level <= 2
  );
  if (valid.length === 0) return;
  const store = await tx('readwrite');
  await Promise.all(valid.map(e => idbReq(store.put(e))));
}

// ─── Lemma Cache ─────────────────────────────────────────────────────

/**
 * Get all cached lemmas for a language.
 * Returns Map<word, lemma|null>. null means "checked, not in Wiktionary".
 */
export async function getLemmaCache(language) {
  const store = await tx('readonly', LEMMA_STORE);
  const all = await idbReq(store.index('by_language').getAll(language));
  const map = new Map();
  for (const r of all) map.set(r.word, r.lemma);
  return map;
}

/**
 * Bulk-write lemma cache entries.
 * Each entry: { language, word, lemma } where lemma is string or null.
 */
export async function putLemmas(entries) {
  if (entries.length === 0) return;
  const store = await tx('readwrite', LEMMA_STORE);
  await Promise.all(entries.map(e => idbReq(store.put(e))));
}

/** Clear all cached lemmas for a language. */
export async function clearLemmaCache(language) {
  const store = await tx('readwrite', LEMMA_STORE);
  const all = await idbReq(store.index('by_language').getAllKeys(language));
  await Promise.all(all.map(k => idbReq(store.delete(k))));
}
