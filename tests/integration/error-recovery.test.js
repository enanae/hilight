/**
 * Integration: Error Recovery
 *
 * Tests that the app recovers gracefully from failures:
 * - loadEpub failure → UI returns to upload state
 * - Scan failure with inBookOnly → panel shows error message (not cross-book words)
 * - closeBook works after partial init failures
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { state, resetState } from '../../src/app-state.js';

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

vi.mock('../../src/vocab-store.js', () => ({
  getAllWords: vi.fn(async () => []),
  setLevel: vi.fn(async () => {}),
  getStats: vi.fn(async () => ({ total: 0 })),
  deleteAllWords: vi.fn(async () => []),
  deleteWordsList: vi.fn(async () => []),
  importVocab: vi.fn(async () => {}),
  exportVocab: vi.fn(async () => []),
  getLevel: vi.fn(async () => 0),
  getLevels: vi.fn(async (_lang, words) => new Map()),
}));

vi.mock('../../src/epub-reader.js', () => ({
  getAllBookWords: vi.fn(async () => null),
  loadEpub: vi.fn(async () => {}),
  destroyEpub: vi.fn(),
  nextPage: vi.fn(),
  prevPage: vi.fn(),
  getToc: vi.fn(async () => []),
  goToHref: vi.fn(),
  getIframeDocument: vi.fn(() => null),
  setLanguage: vi.fn(async () => {}),
  isBookLoaded: vi.fn(() => false),
  getBookId: vi.fn(() => null),
}));

vi.mock('../../src/highlighter.js', () => ({
  highlightContainer: vi.fn(async () => {}),
  handleWordTap: vi.fn(async () => {}),
  showWordDefinition: vi.fn(),
  isPopupActive: vi.fn(() => false),
  resetPopupState: vi.fn(),
  markAllKnown: vi.fn(async () => []),
  restoreWordLevels: vi.fn(async () => {}),
  LEVEL_PARTIAL: 1,
  LEVEL_KNOWN: 2,
}));

import { openPanel, closePanel, resetBookState } from '../../src/vocab-browser.js';
import { getAllWords } from '../../src/vocab-store.js';
import { getAllBookWords } from '../../src/epub-reader.js';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeAll(() => {
  document.body.innerHTML = `
    <div id="app">
      <main class="main-area">
        <div id="toc-panel"></div>
      </main>
    </div>
  `;
});

beforeEach(() => {
  vi.clearAllMocks();
  resetBookState();
  // Remove lingering toasts
  document.querySelectorAll('.undo-toast').forEach(el => el.remove());
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('scan failure with inBookOnly', () => {
  it('shows error message instead of cross-book words when scan returns null', async () => {
    getAllBookWords.mockResolvedValueOnce(null);
    getAllWords.mockResolvedValueOnce([
      { word: 'arabic_word', level: 1 },
      { word: 'french_word', level: 2 },
    ]);

    await openPanel('fr', { bookId: 'french-book' });

    // Panel should be open
    const panel = document.getElementById('vocab-panel');
    expect(panel).not.toBeNull();
    expect(panel.classList.contains('open')).toBe(true);

    // Should show empty state with recovery message, NOT the DB words
    const wordRows = panel.querySelectorAll('.vb-word-row');
    expect(wordRows.length).toBe(0);

    const emptyMsg = panel.querySelector('.vb-empty');
    expect(emptyMsg).not.toBeNull();
    expect(emptyMsg.textContent).toContain('Uncheck');
  });

  it('shows error message instead of cross-book words when scan returns empty Set', async () => {
    getAllBookWords.mockResolvedValueOnce(new Set());
    getAllWords.mockResolvedValueOnce([
      { word: 'old_word', level: 1 },
    ]);

    await openPanel('en', { bookId: 'new-book' });

    const panel = document.getElementById('vocab-panel');
    const wordRows = panel.querySelectorAll('.vb-word-row');
    expect(wordRows.length).toBe(0);

    const emptyMsg = panel.querySelector('.vb-empty');
    expect(emptyMsg).not.toBeNull();
    expect(emptyMsg.textContent).toContain('Uncheck');
  });

  it('recovers to DB words when user unchecks inBookOnly', async () => {
    getAllBookWords.mockResolvedValueOnce(null);
    getAllWords.mockResolvedValueOnce([
      { word: 'saved_word', level: 1 },
    ]);

    await openPanel('en', { bookId: 'recover-book' });

    const panel = document.getElementById('vocab-panel');

    // Initially: no words shown (scan failed, inBookOnly=true)
    expect(panel.querySelectorAll('.vb-word-row').length).toBe(0);

    // Uncheck the "In this book" checkbox
    const cb = panel.querySelector('.vocab-book-cb');
    cb.checked = false;
    cb.dispatchEvent(new Event('change'));

    // Wait for async rebuildDisplayWords
    await vi.waitFor(() => {
      const rows = panel.querySelectorAll('.vb-word-row');
      expect(rows.length).toBe(1);
      expect(rows[0].dataset.word).toBe('saved_word');
    });
  });
});

describe('no book loaded', () => {
  it('shows DB words when no bookId is provided', async () => {
    getAllWords.mockResolvedValueOnce([
      { word: 'cat', level: 1 },
      { word: 'dog', level: 2 },
    ]);

    await openPanel('en'); // no bookId

    const panel = document.getElementById('vocab-panel');
    const wordRows = panel.querySelectorAll('.vb-word-row');
    expect(wordRows.length).toBe(2);

    // Checkbox should be disabled
    const cb = panel.querySelector('.vocab-book-cb');
    expect(cb.disabled).toBe(true);

    // Status should say "No book open"
    const status = panel.querySelector('.vocab-scan-status');
    expect(status.textContent).toBe('No book open');
  });
});
