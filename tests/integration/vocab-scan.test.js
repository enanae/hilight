/**
 * Integration: Vocab Scan Pipeline
 *
 * Tests the REAL getAllBookWords → tokenizer → normalizeWord pipeline.
 * Only mocks epubjs (we don't have real epub files in tests).
 * The tokenizer, normalizer, and scan logic are all real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { state, resetState } from '../../src/app-state.js';

// ---------------------------------------------------------------------------
// Mock helpers — minimal epub structure
// ---------------------------------------------------------------------------

function makeSectionDoc(bodyHtml) {
  const doc = document.implementation.createHTMLDocument('section');
  doc.body.innerHTML = bodyHtml;
  return doc;
}

function createMockSection(href, bodyHtml, index) {
  const doc = makeSectionDoc(bodyHtml);
  const section = {
    href,
    index,
    load: vi.fn(async () => {
      // Simulate real epubjs: stores Document on section.document,
      // returns xml.documentElement (root Element, NOT Document)
      section.document = doc;
      return doc.documentElement;
    }),
    unload: vi.fn(),
  };
  return section;
}

function createMockBook(sections, bookId = 'test-book') {
  const rendition = {
    display: vi.fn(async () => {}),
    next: vi.fn(async () => {}),
    prev: vi.fn(async () => {}),
    destroy: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    hooks: { content: { register: vi.fn() } },
    manager: {
      container: document.createElement('div'),
      views: { _views: [{ document: makeSectionDoc('') }] },
    },
  };

  return {
    ready: Promise.resolve(),
    packaging: { metadata: { title: 'Test', creator: '' } },
    destroy: vi.fn(),
    key: vi.fn(() => bookId),
    spine: {
      items: sections.map((s, i) => ({ href: s.href, index: i })),
      get: vi.fn((ref) => {
        if (typeof ref === 'number') return sections[ref] || null;
        return sections.find(s => s.href === ref) || null;
      }),
    },
    loaded: { navigation: Promise.resolve({ toc: [] }) },
    renderTo: vi.fn(() => rendition),
    load: vi.fn(),
    _rendition: rendition,
  };
}

// ---------------------------------------------------------------------------
// Mock only epubjs — everything else is real
// ---------------------------------------------------------------------------

let mockBook;

vi.mock('epubjs', () => ({
  default: vi.fn(() => mockBook),
}));

// Mock highlighter to avoid DOM side effects during loadEpub
vi.mock('../../src/highlighter.js', () => ({
  highlightContainer: vi.fn(async () => {}),
  handleWordTap: vi.fn(async () => {}),
  showWordDefinition: vi.fn(),
  isPopupActive: vi.fn(() => false),
  resetPopupState: vi.fn(),
  LEVEL_PARTIAL: 1,
  LEVEL_KNOWN: 2,
}));

// Mock vocab-store to avoid IndexedDB
vi.mock('../../src/vocab-store.js', () => ({
  getLevel: vi.fn(async () => 0),
  setLevel: vi.fn(async () => {}),
  getLevels: vi.fn(async (_lang, words) => {
    const map = new Map();
    for (const w of words) map.set(w, 0);
    return map;
  }),
  getStats: vi.fn(async () => ({ total: 0 })),
  getAllWords: vi.fn(async () => []),
  deleteAllWords: vi.fn(async () => []),
  deleteWordsList: vi.fn(async () => []),
  importVocab: vi.fn(async () => {}),
  exportVocab: vi.fn(async () => []),
}));

import { loadEpub, getAllBookWords, destroyEpub } from '../../src/epub-reader.js';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetState();
  destroyEpub();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('vocab scan pipeline (real tokenizer)', () => {
  it('scans English text and returns normalized words', async () => {
    const sections = [
      createMockSection('ch1.xhtml', '<p>The cats walked quickly.</p>', 0),
      createMockSection('ch2.xhtml', '<p>Dogs and cats running together!</p>', 1),
    ];
    mockBook = createMockBook(sections);
    const viewer = document.createElement('div');
    await loadEpub(new ArrayBuffer(8), viewer, 'en');

    const words = await getAllBookWords();

    expect(words).toBeInstanceOf(Set);
    expect(words.size).toBeGreaterThan(0);
    // Verify normalized (lowercase)
    for (const w of words) {
      expect(w).toBe(w.toLowerCase());
    }
    // Verify known words are present
    expect(words.has('the')).toBe(true);
    expect(words.has('cats')).toBe(true);
    expect(words.has('dogs')).toBe(true);
  });

  it('deduplicates words across sections', async () => {
    const sections = [
      createMockSection('ch1.xhtml', '<p>hello world</p>', 0),
      createMockSection('ch2.xhtml', '<p>hello again</p>', 1),
    ];
    mockBook = createMockBook(sections);
    const viewer = document.createElement('div');
    await loadEpub(new ArrayBuffer(8), viewer, 'en');

    const words = await getAllBookWords();

    // "hello" appears in both sections but should only be counted once
    expect(words.has('hello')).toBe(true);
    expect(words.has('world')).toBe(true);
    expect(words.has('again')).toBe(true);
    expect(words.size).toBe(3); // hello, world, again
  });

  it('caches scan results for the same book and language', async () => {
    const sections = [
      createMockSection('ch1.xhtml', '<p>test word</p>', 0),
    ];
    mockBook = createMockBook(sections, 'cache-test-book');
    const viewer = document.createElement('div');
    await loadEpub(new ArrayBuffer(8), viewer, 'en');

    const first = await getAllBookWords();
    const second = await getAllBookWords();

    // Should be the exact same Set reference (cached)
    expect(second).toBe(first);
    // Section load should only have been called once (for the first scan)
    expect(sections[0].load).toHaveBeenCalledTimes(1);
  });

  it('invalidates cache when language changes', async () => {
    const sections = [
      createMockSection('ch1.xhtml', '<p>bonjour monde</p>', 0),
    ];
    mockBook = createMockBook(sections, 'lang-change-book');
    const viewer = document.createElement('div');
    await loadEpub(new ArrayBuffer(8), viewer, 'fr');

    const frWords = await getAllBookWords();
    expect(frWords.size).toBeGreaterThan(0);

    // Change language — should invalidate cache
    state.currentLanguage = 'en';
    const enWords = await getAllBookWords();

    // Should be a new scan (different reference)
    expect(enWords).not.toBe(frWords);
    // Section was loaded again
    expect(sections[0].load).toHaveBeenCalledTimes(2);
  });

  it('does not cache empty scan results', async () => {
    const sections = [
      createMockSection('ch1.xhtml', '', 0),
    ];
    // Make the section fail
    sections[0].load = vi.fn(async () => { throw new Error('corrupt'); });
    mockBook = createMockBook(sections, 'empty-cache-book');
    const viewer = document.createElement('div');
    await loadEpub(new ArrayBuffer(8), viewer, 'en');

    const result = await getAllBookWords();
    expect(result.size).toBe(0);

    // Fix the section for next attempt
    sections[0].load = vi.fn(async () => {
      const goodDoc = makeSectionDoc('<p>recovered</p>');
      sections[0].document = goodDoc;
      return goodDoc.documentElement;
    });

    const retryResult = await getAllBookWords();
    // Should re-scan because empty result wasn't cached
    expect(retryResult.size).toBeGreaterThan(0);
    expect(retryResult.has('recovered')).toBe(true);
  });
});
