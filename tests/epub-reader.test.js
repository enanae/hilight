/**
 * Domain: EPUB Reader
 * Subdomains: Cleanup, Navigation, TOC, Href Resolution,
 *             Language Switching, Spine Scanning, Iframe Access
 *
 * Mocks epubjs default export and highlighter/tokenizer dependencies
 * so tests run without a real epub engine or DOM highlighting pipeline.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/** Build a minimal jsdom document with the given HTML body content. */
function makeSectionDoc(bodyHtml = '') {
  const doc = document.implementation.createHTMLDocument('section');
  doc.body.innerHTML = bodyHtml;
  return doc;
}

/**
 * Create a mock epub section returned by spine.get().
 * `load()` resolves to a jsdom document whose body contains `bodyHtml`.
 */
function createMockSection(href, bodyHtml = '', index = 0) {
  const doc = makeSectionDoc(bodyHtml);
  return {
    href,
    index,
    load: vi.fn(async () => doc),
    unload: vi.fn(),
    _doc: doc, // exposed for assertions
  };
}

/**
 * Create a mock rendition that records calls and exposes a controllable
 * scroll container via `manager.container`.
 */
function createMockRendition() {
  const container = document.createElement('div');
  // Give the container concrete scroll geometry so nextPage / prevPage
  // can decide "at bottom" vs "scroll further".
  Object.defineProperties(container, {
    scrollTop:    { value: 0, writable: true },
    clientHeight: { value: 600, writable: true },
    scrollHeight: { value: 1200, writable: true },
  });
  container.scrollBy = vi.fn(({ top }) => { container.scrollTop += top; });

  const iframeDoc = makeSectionDoc('<p>iframe content</p>');

  const rendition = {
    display:  vi.fn(async () => {}),
    next:     vi.fn(async () => {}),
    prev:     vi.fn(async () => {}),
    destroy:  vi.fn(),
    on:       vi.fn(),
    off:      vi.fn(),
    hooks: {
      content: { register: vi.fn() },
    },
    manager: {
      container,
      views: {
        _views: [{ document: iframeDoc }],
      },
    },
    _iframeDoc: iframeDoc,   // convenience alias
    _container: container,   // convenience alias
  };
  return rendition;
}

/**
 * Create a mock book object returned by the mocked ePub() factory.
 * Spine items, navigation TOC, and metadata are all configurable.
 */
function createMockBook(overrides = {}) {
  const sections = overrides.sections || [
    createMockSection('ch1.xhtml', '<p>hello world</p>', 0),
    createMockSection('ch2.xhtml', '<p>foo bar</p>', 1),
  ];

  const rendition = overrides.rendition || createMockRendition();

  const book = {
    ready: Promise.resolve(),
    packaging: {
      metadata: { title: 'Test Book', creator: 'Test Author', ...(overrides.metadata || {}) },
    },
    destroy: vi.fn(),
    key: vi.fn(() => overrides.bookId || 'test-book-id'),
    spine: {
      items: sections.map((s, i) => ({ href: s.href, index: i })),
      get: vi.fn((ref) => {
        if (typeof ref === 'number') return sections[ref] || null;
        return sections.find(s => s.href === ref) || null;
      }),
    },
    loaded: {
      navigation: Promise.resolve({
        toc: overrides.toc || [
          { label: 'Chapter 1', href: 'ch1.xhtml' },
          { label: 'Chapter 2', href: 'ch2.xhtml' },
        ],
      }),
    },
    renderTo: vi.fn(() => rendition),
    load: vi.fn(),
    _rendition: rendition,
    _sections: sections,
  };
  return book;
}

// ---------------------------------------------------------------------------
// Module-level mocks (must be before imports of the module under test)
// ---------------------------------------------------------------------------

let mockBook;

vi.mock('epubjs', () => ({
  default: vi.fn((...args) => mockBook),
}));

vi.mock('../src/highlighter.js', () => ({
  highlightContainer: vi.fn(async () => {}),
  handleWordTap:      vi.fn(async () => {}),
  showWordDefinition: vi.fn(),
  isPopupActive:      vi.fn(() => false),
  resetPopupState:    vi.fn(),
}));

vi.mock('../src/tokenizer.js', () => ({
  tokenize: vi.fn((text) => {
    // Simple word-boundary split for test purposes
    const parts = text.split(/(\s+)/);
    return parts
      .filter(p => p.length > 0)
      .map(p => ({
        text: p,
        isWord: /\w+/.test(p.trim()) && p.trim().length > 0,
      }));
  }),
  normalizeWord: vi.fn((word) => word.toLowerCase()),
  langToLocale:  vi.fn((lang) => lang),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks are registered)
// ---------------------------------------------------------------------------

import {
  destroyEpub,
  loadEpub,
  nextPage,
  prevPage,
  getToc,
  goToHref,
  setLanguage,
  getIframeDocument,
  getAllBookWords,
} from '../src/epub-reader.js';

import { highlightContainer, resetPopupState, isPopupActive } from '../src/highlighter.js';
import { tokenize, normalizeWord, langToLocale } from '../src/tokenizer.js';
import ePub from 'epubjs';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  destroyEpub(); // reset internal state between tests
  mockBook = createMockBook();
});

// ===========================================================================
// 1. Cleanup (destroyEpub)
// ===========================================================================

describe('destroyEpub', () => {
  it('calls destroy on book and rendition after loadEpub', async () => {
    const viewer = document.createElement('div');
    const { book, rendition } = await loadEpub(new ArrayBuffer(8), viewer, 'en');

    destroyEpub();

    expect(rendition.destroy).toHaveBeenCalled();
    expect(book.destroy).toHaveBeenCalled();
  });

  it('removes event listeners from rendition', async () => {
    const viewer = document.createElement('div');
    const { rendition } = await loadEpub(new ArrayBuffer(8), viewer, 'en');

    destroyEpub();

    const offCalls = rendition.off.mock.calls.map(c => c[0]);
    expect(offCalls).toContain('touchstart');
    expect(offCalls).toContain('touchmove');
    expect(offCalls).toContain('touchend');
    expect(offCalls).toContain('click');
    expect(offCalls).toContain('dblclick');
  });

  it('resets popup state', async () => {
    const viewer = document.createElement('div');
    await loadEpub(new ArrayBuffer(8), viewer, 'en');
    vi.clearAllMocks();

    destroyEpub();

    expect(resetPopupState).toHaveBeenCalled();
  });

  it('is safe to call when nothing is loaded', () => {
    // Should not throw even with no book/rendition
    expect(() => destroyEpub()).not.toThrow();
  });

  it('clears cached book words', async () => {
    const viewer = document.createElement('div');
    await loadEpub(new ArrayBuffer(8), viewer, 'en');

    // Prime the cache
    const words = await getAllBookWords();
    expect(words).toBeInstanceOf(Set);

    destroyEpub();

    // After destroy, getToc returns [] (no book), confirming state is reset
    const toc = await getToc();
    expect(toc).toEqual([]);
  });
});

// ===========================================================================
// 2. Navigation (nextPage / prevPage)
// ===========================================================================

describe('nextPage', () => {
  it('does nothing when no rendition is loaded', () => {
    // No loadEpub called, should return undefined without throwing
    expect(nextPage()).toBeUndefined();
  });

  it('scrolls down when not at the bottom of the section', async () => {
    const viewer = document.createElement('div');
    const { rendition } = await loadEpub(new ArrayBuffer(8), viewer, 'en');
    const container = rendition._container;

    // Not at bottom: scrollTop(0) + clientHeight(600) < scrollHeight(1200) - 5
    nextPage();

    expect(container.scrollBy).toHaveBeenCalledWith({
      top: 560, // clientHeight(600) - 40
      behavior: 'smooth',
    });
    expect(rendition.next).not.toHaveBeenCalled();
  });

  it('goes to next section when at the bottom', async () => {
    const viewer = document.createElement('div');
    const { rendition } = await loadEpub(new ArrayBuffer(8), viewer, 'en');
    const container = rendition._container;

    // Simulate being at the bottom
    container.scrollTop = 600;
    // scrollTop(600) + clientHeight(600) = 1200 >= scrollHeight(1200) - 5

    nextPage();

    expect(rendition.next).toHaveBeenCalled();
  });
});

describe('prevPage', () => {
  it('does nothing when no rendition is loaded', () => {
    expect(prevPage()).toBeUndefined();
  });

  it('scrolls up when not at the top of the section', async () => {
    const viewer = document.createElement('div');
    const { rendition } = await loadEpub(new ArrayBuffer(8), viewer, 'en');
    const container = rendition._container;

    // Not at top: scrollTop > 5
    container.scrollTop = 300;

    prevPage();

    expect(container.scrollBy).toHaveBeenCalledWith({
      top: -560, // -(clientHeight(600) - 40)
      behavior: 'smooth',
    });
    expect(rendition.prev).not.toHaveBeenCalled();
  });

  it('goes to previous section when at the top', async () => {
    const viewer = document.createElement('div');
    const { rendition } = await loadEpub(new ArrayBuffer(8), viewer, 'en');
    const container = rendition._container;

    // At top: scrollTop <= 5
    container.scrollTop = 0;

    prevPage();

    expect(rendition.prev).toHaveBeenCalled();
  });
});

// ===========================================================================
// 3. TOC (getToc)
// ===========================================================================

describe('getToc', () => {
  it('returns empty array when no book is loaded', async () => {
    const toc = await getToc();
    expect(toc).toEqual([]);
  });

  it('returns the navigation TOC from the loaded book', async () => {
    const viewer = document.createElement('div');
    await loadEpub(new ArrayBuffer(8), viewer, 'en');

    const toc = await getToc();
    expect(toc).toEqual([
      { label: 'Chapter 1', href: 'ch1.xhtml' },
      { label: 'Chapter 2', href: 'ch2.xhtml' },
    ]);
  });

  it('returns empty array when navigation has no toc property', async () => {
    mockBook = createMockBook();
    mockBook.loaded.navigation = Promise.resolve({});

    const viewer = document.createElement('div');
    await loadEpub(new ArrayBuffer(8), viewer, 'en');

    const toc = await getToc();
    expect(toc).toEqual([]);
  });
});

// ===========================================================================
// 4. Href Resolution (goToHref)
// ===========================================================================

describe('goToHref', () => {
  it('does nothing when no book is loaded', () => {
    expect(goToHref('ch1.xhtml')).toBeUndefined();
  });

  it('Strategy 1: resolves href directly via spine.get()', async () => {
    const viewer = document.createElement('div');
    const { rendition } = await loadEpub(new ArrayBuffer(8), viewer, 'en');

    goToHref('ch1.xhtml');

    expect(mockBook.spine.get).toHaveBeenCalledWith('ch1.xhtml');
    expect(rendition.display).toHaveBeenCalledWith('ch1.xhtml');
  });

  it('Strategy 1: preserves fragment identifier', async () => {
    const viewer = document.createElement('div');
    const { rendition } = await loadEpub(new ArrayBuffer(8), viewer, 'en');

    goToHref('ch1.xhtml#section2');

    expect(mockBook.spine.get).toHaveBeenCalledWith('ch1.xhtml');
    expect(rendition.display).toHaveBeenCalledWith('ch1.xhtml#section2');
  });

  it('Strategy 2: falls back to basename match', async () => {
    const viewer = document.createElement('div');
    const { rendition } = await loadEpub(new ArrayBuffer(8), viewer, 'en');

    // spine.get won't find the prefixed path, but basename match will
    goToHref('OEBPS/Text/ch1.xhtml');

    // spine.get('OEBPS/Text/ch1.xhtml') returns null, so it falls back to
    // basename matching which finds {href: 'ch1.xhtml'}
    expect(rendition.display).toHaveBeenCalledWith('ch1.xhtml');
  });

  it('Strategy 3: falls back to URL-decoded match', async () => {
    // Create a book with an encoded href in the spine
    const encodedSection = createMockSection('caf%C3%A9.xhtml', '<p>text</p>', 0);
    mockBook = createMockBook({
      sections: [encodedSection],
    });
    // Make spine.get succeed for the decoded form
    mockBook.spine.get = vi.fn((ref) => {
      if (ref === 'caf\u00e9.xhtml') return encodedSection;
      return null;
    });

    const viewer = document.createElement('div');
    const { rendition } = await loadEpub(new ArrayBuffer(8), viewer, 'en');

    goToHref('caf%C3%A9.xhtml');

    expect(rendition.display).toHaveBeenCalledWith('caf%C3%A9.xhtml');
  });

  it('Strategy 4: falls back to suffix match', async () => {
    const section = createMockSection('Text/chapter1.xhtml', '<p>text</p>', 0);
    mockBook = createMockBook({ sections: [section] });
    // spine.get returns null for both direct and decoded lookups
    mockBook.spine.get = vi.fn(() => null);

    const viewer = document.createElement('div');
    const { rendition } = await loadEpub(new ArrayBuffer(8), viewer, 'en');

    // spine item href ends with 'chapter1.xhtml', and so does the input
    goToHref('chapter1.xhtml');

    expect(rendition.display).toHaveBeenCalledWith('Text/chapter1.xhtml');
  });

  it('last resort: passes href directly to display if no strategy matches', async () => {
    mockBook = createMockBook({ sections: [] });
    mockBook.spine.get = vi.fn(() => null);
    mockBook.spine.items = [];

    const viewer = document.createElement('div');
    const { rendition } = await loadEpub(new ArrayBuffer(8), viewer, 'en');

    goToHref('unknown.xhtml');

    expect(rendition.display).toHaveBeenCalledWith('unknown.xhtml');
  });
});

// ===========================================================================
// 5. Language Switching (setLanguage)
// ===========================================================================

describe('setLanguage', () => {
  it('unwraps existing hl-word spans and re-highlights', async () => {
    const rendition = createMockRendition();
    const iframeDoc = rendition._iframeDoc;

    // Simulate highlighted content in the iframe
    iframeDoc.body.innerHTML =
      '<p><span class="hl-word">hello</span> <span class="hl-word">world</span></p>';

    mockBook = createMockBook({ rendition });
    const viewer = document.createElement('div');
    await loadEpub(new ArrayBuffer(8), viewer, 'en');
    vi.clearAllMocks();

    await setLanguage('fr');

    // After unwrapping, no hl-word spans should remain (they were unwrapped)
    // and highlightContainer should have been called to re-wrap them
    expect(highlightContainer).toHaveBeenCalledWith(
      iframeDoc.body,
      'fr',
      expect.objectContaining({ onStatsUpdate: null }),
    );
  });

  it('unwraps spans back to plain text before re-highlighting', async () => {
    const rendition = createMockRendition();
    const iframeDoc = rendition._iframeDoc;
    iframeDoc.body.innerHTML =
      '<p><span class="hl-word">hello</span> <span class="hl-word">world</span></p>';

    mockBook = createMockBook({ rendition });
    const viewer = document.createElement('div');
    await loadEpub(new ArrayBuffer(8), viewer, 'en');
    vi.clearAllMocks();

    // Capture the DOM state at the moment highlightContainer is called
    let bodyHtmlAtCall = '';
    highlightContainer.mockImplementation(async (body) => {
      bodyHtmlAtCall = body.innerHTML;
    });

    await setLanguage('fr');

    // The spans should have been unwrapped: only plain text remains inside <p>
    expect(bodyHtmlAtCall).not.toContain('hl-word');
    expect(bodyHtmlAtCall).toContain('hello');
    expect(bodyHtmlAtCall).toContain('world');
  });

  it('guards against concurrent setLanguage calls (version check)', async () => {
    const rendition = createMockRendition();
    const iframeDoc = rendition._iframeDoc;
    iframeDoc.body.innerHTML = '<p><span class="hl-word">text</span></p>';

    mockBook = createMockBook({ rendition });
    const viewer = document.createElement('div');
    await loadEpub(new ArrayBuffer(8), viewer, 'en');
    vi.clearAllMocks();

    // Start two setLanguage calls concurrently. The first should be
    // superseded by the second because languageVersion will have advanced.
    const p1 = setLanguage('fr');
    const p2 = setLanguage('de');

    await Promise.all([p1, p2]);

    // highlightContainer may be called once or twice, but the last call
    // should be for 'de' (the final language).
    const calls = highlightContainer.mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall[1]).toBe('de');
  });

  it('does nothing when no iframe document exists', async () => {
    const rendition = createMockRendition();
    rendition.manager.views._views = []; // no views -> no iframe doc

    mockBook = createMockBook({ rendition });
    const viewer = document.createElement('div');
    await loadEpub(new ArrayBuffer(8), viewer, 'en');
    vi.clearAllMocks();

    await setLanguage('fr');

    expect(highlightContainer).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 6. Spine Scanning (getAllBookWords)
// ===========================================================================

describe('getAllBookWords', () => {
  it('returns null when no book is loaded', async () => {
    const result = await getAllBookWords();
    expect(result).toBeNull();
  });

  it('collects unique normalized words from all spine sections', async () => {
    const sections = [
      createMockSection('ch1.xhtml', '<p>hello world</p>', 0),
      createMockSection('ch2.xhtml', '<p>world again</p>', 1),
    ];
    mockBook = createMockBook({ sections });

    const viewer = document.createElement('div');
    await loadEpub(new ArrayBuffer(8), viewer, 'en');

    const words = await getAllBookWords();

    expect(words).toBeInstanceOf(Set);
    expect(words.has('hello')).toBe(true);
    expect(words.has('world')).toBe(true);
    expect(words.has('again')).toBe(true);
  });

  it('calls onProgress with increasing fractions', async () => {
    const sections = [
      createMockSection('ch1.xhtml', '<p>a</p>', 0),
      createMockSection('ch2.xhtml', '<p>b</p>', 1),
      createMockSection('ch3.xhtml', '<p>c</p>', 2),
    ];
    mockBook = createMockBook({ sections });

    const viewer = document.createElement('div');
    await loadEpub(new ArrayBuffer(8), viewer, 'en');

    const progressValues = [];
    await getAllBookWords((frac) => progressValues.push(frac));

    expect(progressValues).toEqual([1 / 3, 2 / 3, 1]);
  });

  it('returns cached result on second call with same book and language', async () => {
    const viewer = document.createElement('div');
    await loadEpub(new ArrayBuffer(8), viewer, 'en');

    const first = await getAllBookWords();
    vi.clearAllMocks();

    const second = await getAllBookWords();

    // Should be the exact same Set reference (cached)
    expect(second).toBe(first);
    // spine.get should NOT have been called again
    expect(mockBook.spine.get).not.toHaveBeenCalled();
  });

  it('invalidates cache when language changes', async () => {
    const viewer = document.createElement('div');
    await loadEpub(new ArrayBuffer(8), viewer, 'en');

    const first = await getAllBookWords();
    await setLanguage('fr');
    vi.clearAllMocks();

    const second = await getAllBookWords();

    // Different Set instance because language changed
    expect(second).not.toBe(first);
  });

  it('unloads each section after scanning', async () => {
    const sections = [
      createMockSection('ch1.xhtml', '<p>word</p>', 0),
    ];
    mockBook = createMockBook({ sections });

    const viewer = document.createElement('div');
    await loadEpub(new ArrayBuffer(8), viewer, 'en');

    await getAllBookWords();

    expect(sections[0].unload).toHaveBeenCalled();
  });

  it('skips sections that fail to load', async () => {
    const goodSection = createMockSection('ch1.xhtml', '<p>good</p>', 0);
    const badSection = createMockSection('ch2.xhtml', '', 1);
    badSection.load = vi.fn(async () => { throw new Error('corrupt'); });

    mockBook = createMockBook({ sections: [goodSection, badSection] });

    const viewer = document.createElement('div');
    await loadEpub(new ArrayBuffer(8), viewer, 'en');

    const words = await getAllBookWords();

    // Should still contain words from the good section
    expect(words.has('good')).toBe(true);
    // Should not throw
  });

  it('uses tokenize and normalizeWord from tokenizer', async () => {
    const sections = [
      createMockSection('ch1.xhtml', '<p>Hello World</p>', 0),
    ];
    mockBook = createMockBook({ sections });

    const viewer = document.createElement('div');
    await loadEpub(new ArrayBuffer(8), viewer, 'en');
    vi.clearAllMocks();

    await getAllBookWords();

    expect(langToLocale).toHaveBeenCalledWith('en');
    expect(tokenize).toHaveBeenCalled();
    expect(normalizeWord).toHaveBeenCalled();
  });
});

// ===========================================================================
// 7. Iframe Access (getIframeDocument)
// ===========================================================================

describe('getIframeDocument', () => {
  it('returns null when no rendition is loaded', () => {
    expect(getIframeDocument()).toBeNull();
  });

  it('returns the document from the last view in manager.views', async () => {
    const viewer = document.createElement('div');
    const { rendition } = await loadEpub(new ArrayBuffer(8), viewer, 'en');

    const doc = getIframeDocument();
    expect(doc).toBe(rendition._iframeDoc);
  });

  it('returns the last view document when multiple views exist', async () => {
    const rendition = createMockRendition();
    const doc1 = makeSectionDoc('<p>first</p>');
    const doc2 = makeSectionDoc('<p>second</p>');
    rendition.manager.views._views = [
      { document: doc1 },
      { document: doc2 },
    ];

    mockBook = createMockBook({ rendition });
    const viewer = document.createElement('div');
    await loadEpub(new ArrayBuffer(8), viewer, 'en');

    const doc = getIframeDocument();
    expect(doc).toBe(doc2);
  });

  it('returns null when views array is empty', async () => {
    const rendition = createMockRendition();
    rendition.manager.views._views = [];

    mockBook = createMockBook({ rendition });
    const viewer = document.createElement('div');
    await loadEpub(new ArrayBuffer(8), viewer, 'en');

    expect(getIframeDocument()).toBeNull();
  });

  it('returns null when manager has no views property', async () => {
    const rendition = createMockRendition();
    rendition.manager.views = null;

    mockBook = createMockBook({ rendition });
    const viewer = document.createElement('div');
    await loadEpub(new ArrayBuffer(8), viewer, 'en');

    expect(getIframeDocument()).toBeNull();
  });
});

// ===========================================================================
// loadEpub integration checks
// ===========================================================================

describe('loadEpub', () => {
  it('clears the viewer element', async () => {
    const viewer = document.createElement('div');
    viewer.innerHTML = '<p>old content</p>';

    await loadEpub(new ArrayBuffer(8), viewer, 'en');

    // The original content should be gone (epubjs renderTo replaces it)
    expect(viewer.innerHTML).not.toContain('old content');
  });

  it('calls onBookLoaded with title and creator from metadata', async () => {
    mockBook = createMockBook({
      metadata: { title: 'My Novel', creator: 'Author' },
    });

    const onBookLoaded = vi.fn();
    const viewer = document.createElement('div');
    await loadEpub(new ArrayBuffer(8), viewer, 'en', { onBookLoaded });

    expect(onBookLoaded).toHaveBeenCalledWith({
      title: 'My Novel',
      creator: 'Author',
    });
  });

  it('defaults title to "Untitled" when metadata is empty', async () => {
    mockBook = createMockBook({
      metadata: { title: '', creator: '' },
    });

    const onBookLoaded = vi.fn();
    const viewer = document.createElement('div');
    await loadEpub(new ArrayBuffer(8), viewer, 'en', { onBookLoaded });

    expect(onBookLoaded).toHaveBeenCalledWith({
      title: 'Untitled',
      creator: '',
    });
  });

  it('renders with scrolled-doc flow and full dimensions', async () => {
    const viewer = document.createElement('div');
    await loadEpub(new ArrayBuffer(8), viewer, 'en');

    expect(mockBook.renderTo).toHaveBeenCalledWith(viewer, expect.objectContaining({
      width: '100%',
      height: '100%',
      spread: 'none',
      flow: 'scrolled-doc',
    }));
  });

  it('registers a content hook for highlighting', async () => {
    const viewer = document.createElement('div');
    const { rendition } = await loadEpub(new ArrayBuffer(8), viewer, 'en');

    expect(rendition.hooks.content.register).toHaveBeenCalledWith(
      expect.any(Function),
    );
  });

  it('calls display() to show the first page', async () => {
    const viewer = document.createElement('div');
    const { rendition } = await loadEpub(new ArrayBuffer(8), viewer, 'en');

    expect(rendition.display).toHaveBeenCalled();
  });

  it('destroys previously loaded book before loading a new one', async () => {
    const viewer = document.createElement('div');

    // Load first book
    const firstBook = mockBook;
    const firstRendition = firstBook._rendition;
    await loadEpub(new ArrayBuffer(8), viewer, 'en');

    // Prepare second book
    mockBook = createMockBook();
    await loadEpub(new ArrayBuffer(8), viewer, 'en');

    // First book and rendition should have been destroyed
    expect(firstRendition.destroy).toHaveBeenCalled();
    expect(firstBook.destroy).toHaveBeenCalled();
  });

  it('sets up event listeners for touch and click', async () => {
    const viewer = document.createElement('div');
    const { rendition } = await loadEpub(new ArrayBuffer(8), viewer, 'en');

    const onCalls = rendition.on.mock.calls.map(c => c[0]);
    expect(onCalls).toContain('touchstart');
    expect(onCalls).toContain('touchmove');
    expect(onCalls).toContain('touchend');
    expect(onCalls).toContain('click');
    expect(onCalls).toContain('dblclick');
  });
});
