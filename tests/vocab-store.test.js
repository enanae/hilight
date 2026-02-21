/**
 * Domain: Vocabulary Storage
 * Subdomain: IndexedDB CRUD, Bulk Operations, Statistics, Import/Export
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getLevel, setLevel, getLevels, getAllWords, getStats,
  deleteAllWords, deleteWordsList, exportVocab, importVocab,
} from '../src/vocab-store.js';

// Each test gets a fresh DB state by clearing all words
beforeEach(async () => {
  await deleteAllWords('en');
  await deleteAllWords('es');
});

// ── Subdomain: Single word CRUD ──────────────────────────────────────

describe('setLevel / getLevel', () => {
  it('stores and retrieves a word level', async () => {
    await setLevel('en', 'hello', 2);
    const level = await getLevel('en', 'hello');
    expect(level).toBe(2);
  });

  it('returns 0 for unknown words', async () => {
    const level = await getLevel('en', 'nonexistent');
    expect(level).toBe(0);
  });

  it('setting level 0 deletes the entry', async () => {
    await setLevel('en', 'hello', 1);
    expect(await getLevel('en', 'hello')).toBe(1);
    await setLevel('en', 'hello', 0);
    expect(await getLevel('en', 'hello')).toBe(0);
  });

  it('overwrites previous level', async () => {
    await setLevel('en', 'hello', 1);
    await setLevel('en', 'hello', 2);
    expect(await getLevel('en', 'hello')).toBe(2);
  });

  it('isolates words by language', async () => {
    await setLevel('en', 'hello', 2);
    await setLevel('es', 'hello', 1);
    expect(await getLevel('en', 'hello')).toBe(2);
    expect(await getLevel('es', 'hello')).toBe(1);
  });
});

// ── Subdomain: Bulk lookup ───────────────────────────────────────────

describe('getLevels', () => {
  it('returns a map of word levels', async () => {
    await setLevel('en', 'cat', 1);
    await setLevel('en', 'dog', 2);
    const levels = await getLevels('en', ['cat', 'dog', 'bird']);
    expect(levels.get('cat')).toBe(1);
    expect(levels.get('dog')).toBe(2);
    expect(levels.get('bird')).toBe(0);
  });

  it('handles empty word list', async () => {
    const levels = await getLevels('en', []);
    expect(levels.size).toBe(0);
  });

  it('deduplicates words', async () => {
    await setLevel('en', 'cat', 1);
    const levels = await getLevels('en', ['cat', 'cat', 'cat']);
    expect(levels.size).toBe(1);
    expect(levels.get('cat')).toBe(1);
  });
});

// ── Subdomain: getAllWords ────────────────────────────────────────────

describe('getAllWords', () => {
  it('returns all stored words for a language', async () => {
    await setLevel('en', 'cat', 1);
    await setLevel('en', 'dog', 2);
    const words = await getAllWords('en');
    expect(words).toHaveLength(2);
    expect(words.map(w => w.word).sort()).toEqual(['cat', 'dog']);
  });

  it('does not include level 0 words', async () => {
    await setLevel('en', 'cat', 1);
    await setLevel('en', 'cat', 0);
    const words = await getAllWords('en');
    expect(words).toHaveLength(0);
  });

  it('returns empty array for language with no words', async () => {
    const words = await getAllWords('xx');
    expect(words).toEqual([]);
  });
});

// ── Subdomain: Statistics ────────────────────────────────────────────

describe('getStats', () => {
  it('returns correct partial/known/total counts', async () => {
    await setLevel('en', 'cat', 1);
    await setLevel('en', 'dog', 1);
    await setLevel('en', 'bird', 2);
    const stats = await getStats('en');
    expect(stats.partial).toBe(2);
    expect(stats.known).toBe(1);
    expect(stats.total).toBe(3);
  });

  it('returns zeros for empty language', async () => {
    const stats = await getStats('xx');
    expect(stats).toEqual({ partial: 0, known: 0, total: 0 });
  });
});

// ── Subdomain: Bulk delete ───────────────────────────────────────────

describe('deleteAllWords', () => {
  it('removes all words for a language and returns them', async () => {
    await setLevel('en', 'cat', 1);
    await setLevel('en', 'dog', 2);
    const deleted = await deleteAllWords('en');
    expect(deleted).toHaveLength(2);
    expect(await getAllWords('en')).toHaveLength(0);
  });

  it('returns deleted entries with language, word, and level', async () => {
    await setLevel('en', 'cat', 1);
    const deleted = await deleteAllWords('en');
    expect(deleted[0]).toHaveProperty('language', 'en');
    expect(deleted[0]).toHaveProperty('word', 'cat');
    expect(deleted[0]).toHaveProperty('level', 1);
  });

  it('does not affect other languages', async () => {
    await setLevel('en', 'cat', 1);
    await setLevel('es', 'gato', 1);
    await deleteAllWords('en');
    expect(await getLevel('es', 'gato')).toBe(1);
  });

  it('returns empty array for language with no words', async () => {
    const deleted = await deleteAllWords('xx');
    expect(deleted).toEqual([]);
  });
});

describe('deleteWordsList', () => {
  it('deletes specific words and returns those that existed', async () => {
    await setLevel('en', 'cat', 1);
    await setLevel('en', 'dog', 2);
    await setLevel('en', 'bird', 1);
    const deleted = await deleteWordsList('en', ['cat', 'bird', 'fish']);
    expect(deleted).toHaveLength(2);
    expect(deleted.map(d => d.word).sort()).toEqual(['bird', 'cat']);
    expect(await getLevel('en', 'dog')).toBe(2);
    expect(await getLevel('en', 'cat')).toBe(0);
  });

  it('returns empty array when no words match', async () => {
    const deleted = await deleteWordsList('en', ['nonexistent']);
    expect(deleted).toEqual([]);
  });
});

// ── Subdomain: Import / Export ───────────────────────────────────────

describe('exportVocab / importVocab', () => {
  it('exports all entries for a language', async () => {
    await setLevel('en', 'cat', 1);
    await setLevel('en', 'dog', 2);
    const exported = await exportVocab('en');
    expect(exported).toHaveLength(2);
    expect(exported[0]).toHaveProperty('language');
    expect(exported[0]).toHaveProperty('word');
    expect(exported[0]).toHaveProperty('level');
  });

  it('imports entries and makes them retrievable', async () => {
    const entries = [
      { language: 'en', word: 'alpha', level: 1 },
      { language: 'en', word: 'beta', level: 2 },
    ];
    await importVocab(entries);
    expect(await getLevel('en', 'alpha')).toBe(1);
    expect(await getLevel('en', 'beta')).toBe(2);
  });

  it('validates entries and skips invalid ones', async () => {
    const entries = [
      { language: 'en', word: 'valid', level: 1 },
      { language: 'en', word: 'bad-level', level: 5 },
      { word: 'missing-language', level: 1 },
      null,
    ];
    await importVocab(entries);
    expect(await getLevel('en', 'valid')).toBe(1);
    expect(await getLevel('en', 'bad-level')).toBe(0);
  });

  it('roundtrips through export and import', async () => {
    await setLevel('en', 'cat', 1);
    await setLevel('en', 'dog', 2);
    const exported = await exportVocab('en');
    await deleteAllWords('en');
    expect(await getAllWords('en')).toHaveLength(0);
    await importVocab(exported);
    expect(await getLevel('en', 'cat')).toBe(1);
    expect(await getLevel('en', 'dog')).toBe(2);
  });
});
