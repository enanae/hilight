/**
 * Vocabulary storage backed by IndexedDB.
 * Each word entry is keyed by (language, word) and stores a knowledge level:
 *   0 = unknown (default, not stored)
 *   1 = partially known
 *   2 = known
 */

const DB_NAME = 'hilight-vocab';
const DB_VERSION = 1;
const STORE_NAME = 'words';

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
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null; // allow retry on next call
      reject(req.error);
    };
  });
  return dbPromise;
}

function tx(mode) {
  return openDB().then(db => {
    const t = db.transaction(STORE_NAME, mode);
    return t.objectStore(STORE_NAME);
  });
}

/** Get the knowledge level for a single word (0 if not stored). */
export async function getLevel(language, word) {
  const store = await tx('readonly');
  return new Promise((resolve, reject) => {
    const req = store.get([language, word]);
    req.onsuccess = () => resolve(req.result ? req.result.level : 0);
    req.onerror = () => reject(req.error);
  });
}

/** Set the knowledge level for a word. Level 0 deletes the entry. */
export async function setLevel(language, word, level) {
  const store = await tx('readwrite');
  return new Promise((resolve, reject) => {
    let req;
    if (level === 0) {
      req = store.delete([language, word]);
    } else {
      req = store.put({ language, word, level });
    }
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Bulk-lookup: given an array of words, returns a Map<word, level>.
 * Words not in the DB are returned as level 0.
 */
export async function getLevels(language, words) {
  const store = await tx('readonly');
  const map = new Map();
  const unique = [...new Set(words)];
  await Promise.all(unique.map(w =>
    new Promise((resolve, reject) => {
      const req = store.get([language, w]);
      req.onsuccess = () => {
        map.set(w, req.result ? req.result.level : 0);
        resolve();
      };
      req.onerror = () => reject(req.error);
    })
  ));
  return map;
}

/** Get all words for a language at a given level. */
export async function getWordsByLevel(language, level) {
  const store = await tx('readonly');
  return new Promise((resolve, reject) => {
    const idx = store.index('by_level');
    const req = idx.getAll([language, level]);
    req.onsuccess = () => resolve(req.result.map(r => r.word));
    req.onerror = () => reject(req.error);
  });
}

/** Get vocabulary stats for a language. */
export async function getStats(language) {
  const store = await tx('readonly');
  return new Promise((resolve, reject) => {
    const idx = store.index('by_language');
    const req = idx.getAll(language);
    req.onsuccess = () => {
      const all = req.result;
      resolve({
        partial: all.filter(r => r.level === 1).length,
        known: all.filter(r => r.level === 2).length,
        total: all.length,
      });
    };
    req.onerror = () => reject(req.error);
  });
}

/** Get all words + levels for a language. Returns [{word, level}, ...]. */
export async function getAllWords(language) {
  const store = await tx('readonly');
  return new Promise((resolve, reject) => {
    const idx = store.index('by_language');
    const req = idx.getAll(language);
    req.onsuccess = () => resolve(req.result.map(r => ({ word: r.word, level: r.level })));
    req.onerror = () => reject(req.error);
  });
}

/** Export all vocab for a language as JSON array. */
export async function exportVocab(language) {
  const store = await tx('readonly');
  return new Promise((resolve, reject) => {
    const idx = store.index('by_language');
    const req = idx.getAll(language);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
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
  return Promise.all(valid.map(e =>
    new Promise((resolve, reject) => {
      const req = store.put(e);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    })
  ));
}
