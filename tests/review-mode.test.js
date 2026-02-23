/**
 * Domain: Review Mode
 * Subdomains: Enter/Exit, Word Navigation, Focus Management, Filtering
 *
 * Tests the review-mode module using jsdom-simulated word spans.
 * Mocks vocab-store to avoid IndexedDB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { state, resetState } from '../src/app-state.js';

// Mock vocab-store (imported indirectly via highlighter)
vi.mock('../src/vocab-store.js', () => ({
  getLevel: vi.fn(async () => 0),
  setLevel: vi.fn(async () => {}),
  getLevels: vi.fn(async (_lang, words) => {
    const map = new Map();
    for (const w of words) map.set(w, 0);
    return map;
  }),
}));

// Mock dictionary (not needed for review tests)
vi.mock('../src/dictionary.js', () => ({
  lookupWord: vi.fn(async () => ({ error: 'not-found' })),
  hasDictionary: vi.fn(() => false),
}));

import {
  isReviewMode,
  enterReviewMode,
  exitReviewMode,
  focusNextWord,
  focusPrevWord,
  focusWord,
  getFocusedWord,
  toggleFilter,
  isShowingAll,
} from '../src/review-mode.js';

/** Create a mock iframe document with word spans. */
function makeIframeDoc(words) {
  const doc = document.implementation.createHTMLDocument('iframe');
  const p = doc.createElement('p');
  for (const { text, level } of words) {
    const span = doc.createElement('span');
    span.textContent = text;
    span.className = `hl-word hl-${['unknown', 'partial', 'known'][level]}`;
    span.dataset.word = text.toLowerCase();
    span.dataset.level = level;
    span.dataset.language = 'en';
    // Mock scrollIntoView for jsdom
    span.scrollIntoView = vi.fn();
    p.appendChild(span);
  }
  doc.body.appendChild(p);
  return doc;
}

beforeEach(() => {
  resetState();
});

// ── Enter / Exit ──────────────────────────────────────────────────────

describe('enterReviewMode', () => {
  it('activates review mode and focuses the first word', () => {
    const doc = makeIframeDoc([
      { text: 'hello', level: 0 },
      { text: 'world', level: 0 },
    ]);
    enterReviewMode(doc);
    expect(isReviewMode()).toBe(true);
    expect(getFocusedWord()).not.toBeNull();
    expect(getFocusedWord().textContent).toBe('hello');
    expect(getFocusedWord().classList.contains('hl-focused')).toBe(true);
    exitReviewMode();
  });

  it('does not activate when no words exist', () => {
    const doc = document.implementation.createHTMLDocument('empty');
    enterReviewMode(doc);
    expect(isReviewMode()).toBe(false);
    expect(getFocusedWord()).toBeNull();
  });

  it('skips known words by default', () => {
    const doc = makeIframeDoc([
      { text: 'the', level: 2 },   // known — should be skipped
      { text: 'cat', level: 0 },   // unknown — should be focused
    ]);
    enterReviewMode(doc);
    expect(getFocusedWord().textContent).toBe('cat');
    exitReviewMode();
  });

  it('does not enter if iframeDoc is null', () => {
    enterReviewMode(null);
    expect(isReviewMode()).toBe(false);
  });

  it('starts from the last interacted word when set', () => {
    const doc = makeIframeDoc([
      { text: 'hello', level: 0 },
      { text: 'world', level: 0 },
      { text: 'foo', level: 0 },
    ]);
    // Simulate user clicking "world"
    const spans = doc.querySelectorAll('.hl-word');
    state.lastInteractedWord = spans[1]; // "world"
    enterReviewMode(doc);
    expect(getFocusedWord().textContent).toBe('world');
    exitReviewMode();
  });

  it('starts from nearest eligible word when last interacted is known', () => {
    const doc = makeIframeDoc([
      { text: 'hello', level: 0 },
      { text: 'the', level: 2 },   // known — filtered out
      { text: 'world', level: 0 },
    ]);
    // User clicked "the" (known word, filtered out in default mode)
    const spans = doc.querySelectorAll('.hl-word');
    state.lastInteractedWord = spans[1]; // "the"
    enterReviewMode(doc);
    // Should focus "world" — the nearest eligible word after "the"
    expect(getFocusedWord().textContent).toBe('world');
    exitReviewMode();
  });

  it('falls back to first word when last interacted is from a different page', () => {
    const doc = makeIframeDoc([
      { text: 'hello', level: 0 },
      { text: 'world', level: 0 },
    ]);
    // Set a span from a different document
    const otherDoc = makeIframeDoc([{ text: 'other', level: 0 }]);
    state.lastInteractedWord = otherDoc.querySelector('.hl-word');
    enterReviewMode(doc);
    expect(getFocusedWord().textContent).toBe('hello'); // falls back to first
    exitReviewMode();
  });

  it('focuses last word when direction is backward (chapter resume)', () => {
    const doc = makeIframeDoc([
      { text: 'hello', level: 0 },
      { text: 'world', level: 0 },
      { text: 'foo', level: 0 },
    ]);
    enterReviewMode(doc, { direction: 'backward' });
    expect(getFocusedWord().textContent).toBe('foo'); // last word
    exitReviewMode();
  });

  it('focuses first word when direction is forward (default)', () => {
    const doc = makeIframeDoc([
      { text: 'hello', level: 0 },
      { text: 'world', level: 0 },
    ]);
    enterReviewMode(doc, { direction: 'forward' });
    expect(getFocusedWord().textContent).toBe('hello');
    exitReviewMode();
  });

  it('direction is ignored when lastInteractedWord is valid', () => {
    const doc = makeIframeDoc([
      { text: 'hello', level: 0 },
      { text: 'world', level: 0 },
      { text: 'foo', level: 0 },
    ]);
    const spans = doc.querySelectorAll('.hl-word');
    state.lastInteractedWord = spans[1]; // "world"
    // direction=backward should be overridden by lastInteractedWord
    enterReviewMode(doc, { direction: 'backward' });
    expect(getFocusedWord().textContent).toBe('world');
    exitReviewMode();
  });
});

describe('exitReviewMode', () => {
  it('deactivates review mode and removes focus', () => {
    const doc = makeIframeDoc([{ text: 'hello', level: 0 }]);
    enterReviewMode(doc);
    const focused = getFocusedWord();
    exitReviewMode();
    expect(isReviewMode()).toBe(false);
    expect(getFocusedWord()).toBeNull();
    expect(focused.classList.contains('hl-focused')).toBe(false);
  });
});

// ── Word Navigation ───────────────────────────────────────────────────

describe('focusNextWord', () => {
  it('moves focus to the next word', () => {
    const doc = makeIframeDoc([
      { text: 'hello', level: 0 },
      { text: 'world', level: 0 },
    ]);
    enterReviewMode(doc);
    expect(getFocusedWord().textContent).toBe('hello');

    const result = focusNextWord(doc);
    expect(result).toBe('moved');
    expect(getFocusedWord().textContent).toBe('world');
    exitReviewMode();
  });

  it('returns "end" when at the last word', () => {
    const doc = makeIframeDoc([{ text: 'only', level: 0 }]);
    enterReviewMode(doc);
    const result = focusNextWord(doc);
    expect(result).toBe('end');
    exitReviewMode();
  });

  it('skips known words in default filter mode', () => {
    const doc = makeIframeDoc([
      { text: 'hello', level: 0 },
      { text: 'the', level: 2 },   // known — skipped
      { text: 'world', level: 1 },
    ]);
    enterReviewMode(doc);
    const result = focusNextWord(doc);
    expect(result).toBe('moved');
    expect(getFocusedWord().textContent).toBe('world');
    exitReviewMode();
  });

  it('advances to nearest word when focused word is graded as known', () => {
    const doc = makeIframeDoc([
      { text: 'hello', level: 0 },
      { text: 'world', level: 0 },
      { text: 'foo', level: 0 },
    ]);
    enterReviewMode(doc);
    focusNextWord(doc);
    expect(getFocusedWord().textContent).toBe('world');

    // Simulate grading "world" as known — changes DOM level
    const worldSpan = getFocusedWord();
    worldSpan.dataset.level = '2';
    worldSpan.className = 'hl-word hl-known';

    // focusNextWord should advance to "foo" (not jump to "hello")
    const result = focusNextWord(doc);
    expect(result).toBe('moved');
    expect(getFocusedWord().textContent).toBe('foo');
    exitReviewMode();
  });

  it('returns "end" when graded word was the last eligible', () => {
    const doc = makeIframeDoc([
      { text: 'hello', level: 0 },
      { text: 'world', level: 0 },
    ]);
    enterReviewMode(doc);
    focusNextWord(doc);
    expect(getFocusedWord().textContent).toBe('world');

    // Grade "world" as known — now only "hello" is eligible
    const worldSpan = getFocusedWord();
    worldSpan.dataset.level = '2';
    worldSpan.className = 'hl-word hl-known';

    // No eligible words after "world" → should return 'end'
    const result = focusNextWord(doc);
    expect(result).toBe('end');
    exitReviewMode();
  });
});

describe('focusPrevWord', () => {
  it('moves focus to the previous word', () => {
    const doc = makeIframeDoc([
      { text: 'hello', level: 0 },
      { text: 'world', level: 0 },
    ]);
    enterReviewMode(doc);
    focusNextWord(doc);
    expect(getFocusedWord().textContent).toBe('world');

    const result = focusPrevWord(doc);
    expect(result).toBe('moved');
    expect(getFocusedWord().textContent).toBe('hello');
    exitReviewMode();
  });

  it('returns "start" when at the first word', () => {
    const doc = makeIframeDoc([{ text: 'only', level: 0 }]);
    enterReviewMode(doc);
    const result = focusPrevWord(doc);
    expect(result).toBe('start');
    exitReviewMode();
  });

  it('retreats to nearest word when focused word is graded as known', () => {
    const doc = makeIframeDoc([
      { text: 'hello', level: 0 },
      { text: 'world', level: 0 },
      { text: 'foo', level: 0 },
    ]);
    enterReviewMode(doc);
    focusNextWord(doc);
    expect(getFocusedWord().textContent).toBe('world');

    // Grade "world" as known
    const worldSpan = getFocusedWord();
    worldSpan.dataset.level = '2';
    worldSpan.className = 'hl-word hl-known';

    // focusPrevWord should go to "hello" (not return 'start' prematurely)
    const result = focusPrevWord(doc);
    expect(result).toBe('moved');
    expect(getFocusedWord().textContent).toBe('hello');
    exitReviewMode();
  });

  it('returns "start" when graded word was the first eligible', () => {
    const doc = makeIframeDoc([
      { text: 'hello', level: 0 },
      { text: 'world', level: 0 },
    ]);
    enterReviewMode(doc);
    expect(getFocusedWord().textContent).toBe('hello');

    // Grade "hello" as known
    const helloSpan = getFocusedWord();
    helloSpan.dataset.level = '2';
    helloSpan.className = 'hl-word hl-known';

    // No eligible words before "hello" → should return 'start'
    const result = focusPrevWord(doc);
    expect(result).toBe('start');
    exitReviewMode();
  });
});

// ── Focus Ring ────────────────────────────────────────────────────────

describe('focusWord', () => {
  it('moves focus ring from one word to another', () => {
    const doc = makeIframeDoc([
      { text: 'hello', level: 0 },
      { text: 'world', level: 0 },
    ]);
    enterReviewMode(doc);
    const first = getFocusedWord();
    const second = doc.querySelectorAll('.hl-word')[1];
    second.scrollIntoView = vi.fn();

    focusWord(second);
    expect(first.classList.contains('hl-focused')).toBe(false);
    expect(second.classList.contains('hl-focused')).toBe(true);
    expect(getFocusedWord()).toBe(second);
    exitReviewMode();
  });
});

// ── Filtering ─────────────────────────────────────────────────────────

describe('toggleFilter', () => {
  it('toggles between all words and unknown+partial only', () => {
    const doc = makeIframeDoc([
      { text: 'hello', level: 0 },
      { text: 'the', level: 2 },
      { text: 'world', level: 1 },
    ]);
    enterReviewMode(doc);
    expect(isShowingAll()).toBe(false);

    toggleFilter(doc);
    expect(isShowingAll()).toBe(true);

    // In "all" mode, navigating should include known words
    // Reset to first word
    focusWord(doc.querySelectorAll('.hl-word')[0]);
    const r1 = focusNextWord(doc);
    expect(r1).toBe('moved');
    expect(getFocusedWord().textContent).toBe('the'); // known word now included

    toggleFilter(doc);
    expect(isShowingAll()).toBe(false);
    exitReviewMode();
  });

  it('keeps current focus if still eligible after toggle', () => {
    const doc = makeIframeDoc([
      { text: 'hello', level: 0 },
      { text: 'world', level: 1 },
    ]);
    enterReviewMode(doc);
    focusNextWord(doc);
    expect(getFocusedWord().textContent).toBe('world');

    toggleFilter(doc); // to "all" — world is still eligible
    expect(getFocusedWord().textContent).toBe('world');
    exitReviewMode();
  });
});

// ── Edge Cases ────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('handles empty document gracefully', () => {
    const doc = document.implementation.createHTMLDocument('empty');
    expect(focusNextWord(doc)).toBe('end');
    expect(focusPrevWord(doc)).toBe('start');
  });

  it('handles null document gracefully', () => {
    expect(focusNextWord(null)).toBe('end');
    expect(focusPrevWord(null)).toBe('start');
  });

  it('all words known — does not enter review mode in default filter', () => {
    const doc = makeIframeDoc([
      { text: 'the', level: 2 },
      { text: 'a', level: 2 },
    ]);
    enterReviewMode(doc);
    expect(isReviewMode()).toBe(false); // no eligible words
  });
});
