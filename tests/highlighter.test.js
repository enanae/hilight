/**
 * Domain: Reader / Highlighting
 * Subdomain: DOM Highlighting, Level Cycling, Bulk Mark, Undo
 *
 * These tests use jsdom to simulate the epub iframe document.
 * They mock vocab-store to avoid IndexedDB in DOM tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock vocab-store so highlighter doesn't hit real IndexedDB
vi.mock('../src/vocab-store.js', () => ({
  getLevel: vi.fn(async () => 0),
  setLevel: vi.fn(async () => {}),
  getLevels: vi.fn(async (_lang, words) => {
    const map = new Map();
    for (const w of words) map.set(w, 0);
    return map;
  }),
}));

// Mock dictionary (not needed for highlight tests)
vi.mock('../src/dictionary.js', () => ({
  lookupWord: vi.fn(async () => ({ error: 'not-found' })),
  hasDictionary: vi.fn(() => false),
}));

import { highlightContainer, markAllKnown, restoreWordLevels, handleWordTap } from '../src/highlighter.js';
import { setLevel, getLevels } from '../src/vocab-store.js';

function makeDoc(html) {
  const container = document.createElement('div');
  container.innerHTML = html;
  return container;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Subdomain: highlightContainer ────────────────────────────────────

describe('highlightContainer', () => {
  it('wraps each word in a .hl-word span', async () => {
    const container = makeDoc('hello world');
    await highlightContainer(container, 'en');
    const spans = container.querySelectorAll('.hl-word');
    expect(spans.length).toBe(2);
    expect(spans[0].textContent).toBe('hello');
    expect(spans[1].textContent).toBe('world');
  });

  it('sets data-word to normalized form', async () => {
    const container = makeDoc('Hello');
    await highlightContainer(container, 'en');
    const span = container.querySelector('.hl-word');
    expect(span.dataset.word).toBe('hello');
  });

  it('sets data-language on each span', async () => {
    const container = makeDoc('hello');
    await highlightContainer(container, 'fr');
    const span = container.querySelector('.hl-word');
    expect(span.dataset.language).toBe('fr');
  });

  it('sets data-level based on vocab-store lookup', async () => {
    getLevels.mockResolvedValueOnce(new Map([['hello', 2]]));
    const container = makeDoc('hello');
    await highlightContainer(container, 'en');
    const span = container.querySelector('.hl-word');
    expect(span.dataset.level).toBe('2');
    expect(span.classList.contains('hl-known')).toBe(true);
  });

  it('assigns hl-unknown class for level 0', async () => {
    const container = makeDoc('hello');
    await highlightContainer(container, 'en');
    const span = container.querySelector('.hl-word');
    expect(span.classList.contains('hl-unknown')).toBe(true);
  });

  it('preserves non-word text', async () => {
    const container = makeDoc('hello, world!');
    await highlightContainer(container, 'en');
    expect(container.textContent).toBe('hello, world!');
  });

  it('handles empty container', async () => {
    const container = makeDoc('');
    await highlightContainer(container, 'en');
    expect(container.querySelectorAll('.hl-word').length).toBe(0);
  });

  it('skips nodes removed by concurrent operations', async () => {
    // Simulate a text node being removed before replaceChild
    const container = makeDoc('hello world');
    const textNodes = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    // Remove the text node before highlighting (simulates race condition)
    if (textNodes[0]?.parentNode) {
      textNodes[0].parentNode.removeChild(textNodes[0]);
    }

    // Should not throw
    await highlightContainer(container, 'en');
  });
});

// ── Subdomain: markAllKnown ──────────────────────────────────────────

describe('markAllKnown', () => {
  it('marks all non-known spans as known', async () => {
    const container = makeDoc('hello world');
    await highlightContainer(container, 'en');

    const previousState = await markAllKnown(container);
    const spans = container.querySelectorAll('.hl-word');
    for (const span of spans) {
      expect(span.dataset.level).toBe('2');
      expect(span.classList.contains('hl-known')).toBe(true);
    }
    expect(previousState.length).toBe(2);
  });

  it('returns previous state for each unique word', async () => {
    const container = makeDoc('hello hello world');
    await highlightContainer(container, 'en');
    const prev = await markAllKnown(container);
    // "hello" appears twice but should only be in previousState once
    expect(prev.length).toBe(2); // hello, world
    expect(prev.find(p => p.word === 'hello')).toBeDefined();
    expect(prev.find(p => p.word === 'world')).toBeDefined();
  });

  it('calls setLevel for each unique word', async () => {
    const container = makeDoc('cat dog');
    await highlightContainer(container, 'en');
    vi.clearAllMocks();
    await markAllKnown(container);
    expect(setLevel).toHaveBeenCalledTimes(2);
  });

  it('returns empty array when all words already known', async () => {
    getLevels.mockResolvedValueOnce(new Map([['hello', 2]]));
    const container = makeDoc('hello');
    await highlightContainer(container, 'en');
    const prev = await markAllKnown(container);
    expect(prev).toEqual([]);
  });
});

// ── Subdomain: restoreWordLevels ─────────────────────────────────────

describe('restoreWordLevels', () => {
  it('restores spans to their previous levels', async () => {
    const container = makeDoc('hello world');
    await highlightContainer(container, 'en');
    const prev = await markAllKnown(container);

    vi.clearAllMocks();
    await restoreWordLevels(container, prev);

    const spans = container.querySelectorAll('.hl-word');
    for (const span of spans) {
      expect(span.dataset.level).toBe('0');
      expect(span.classList.contains('hl-unknown')).toBe(true);
    }
  });

  it('calls setLevel for each word in previous state', async () => {
    const container = makeDoc('hello');
    await highlightContainer(container, 'en');
    await markAllKnown(container);
    vi.clearAllMocks();

    const prev = [{ language: 'en', word: 'hello', level: 0 }];
    await restoreWordLevels(container, prev);
    expect(setLevel).toHaveBeenCalledWith('en', 'hello', 0);
  });
});

// ── Subdomain: handleWordTap (level cycling) ─────────────────────────

describe('handleWordTap', () => {
  // handleWordTap uses span.ownerDocument.querySelectorAll, so the
  // container must be attached to the document for queries to find spans.
  it('cycles level 0 → 1 → 2 → 0', async () => {
    const container = makeDoc('hello');
    document.body.appendChild(container);
    await highlightContainer(container, 'en');
    const span = container.querySelector('.hl-word');

    await handleWordTap(span);
    expect(span.dataset.level).toBe('1');
    expect(span.classList.contains('hl-partial')).toBe(true);

    await handleWordTap(span);
    expect(span.dataset.level).toBe('2');
    expect(span.classList.contains('hl-known')).toBe(true);

    await handleWordTap(span);
    expect(span.dataset.level).toBe('0');
    expect(span.classList.contains('hl-unknown')).toBe(true);
    container.remove();
  });

  it('updates all spans for the same word in the document', async () => {
    const container = makeDoc('hello and hello');
    document.body.appendChild(container);
    await highlightContainer(container, 'en');
    const spans = container.querySelectorAll('.hl-word[data-word="hello"]');
    expect(spans.length).toBe(2);

    await handleWordTap(spans[0]);
    expect(spans[1].dataset.level).toBe('1');
    container.remove();
  });

  it('calls setLevel with correct arguments', async () => {
    const container = makeDoc('cat');
    document.body.appendChild(container);
    await highlightContainer(container, 'en');
    vi.clearAllMocks();

    const span = container.querySelector('.hl-word');
    await handleWordTap(span);
    expect(setLevel).toHaveBeenCalledWith('en', 'cat', 1);
    container.remove();
  });
});
