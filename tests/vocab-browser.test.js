/**
 * Domain: Vocabulary Browser
 * Subdomain: Panel Lifecycle, Filtering, Search, Stem Grouping,
 *            Word Cycling, Group Marking, Forget Operations,
 *            Event Delegation, In-Book Mode
 *
 * Tests exercise the exported API (openPanel, closePanel, isOpen,
 * togglePanel) and verify DOM output produced by the internal
 * renderList, cycleWord, markGroup, and forget flows.
 *
 * Dependencies (vocab-store, epub-reader, highlighter) are mocked.
 * The stemmer is real so grouping logic matches production behavior.
 *
 * IMPORTANT: vocab-browser.js holds module-level state (panelEl,
 * activeFilter, inBookOnly, bookWordSet, etc.) that persists across
 * tests. The panel DOM element is created once by ensurePanel() and
 * reused. We set up the outer DOM shell once and keep it stable so
 * the panel element stays attached to the document tree.
 *
 * Stem reference (verified via stemmer.js):
 *   walked/walking -> "wal"   |  cats/cat  -> "cat"
 *   tested/testing -> "tes"   |  asked/asking/asks -> "ask"
 *   teachers/teacher/teaching -> "teach"
 *   kindness/kindly/kinds -> "kind"
 *   singing/singer/sings -> "sing"
 *   loved/lovers/loving -> "lov"
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

vi.mock('../src/vocab-store.js', () => ({
  getAllWords: vi.fn(async () => []),
  setLevel: vi.fn(async () => {}),
  deleteAllWords: vi.fn(async () => []),
  deleteWordsList: vi.fn(async () => []),
  importVocab: vi.fn(async () => {}),
}));

vi.mock('../src/epub-reader.js', () => ({
  getAllBookWords: vi.fn(async () => null),
  getIframeDocument: vi.fn(() => null),
}));

vi.mock('../src/highlighter.js', () => ({
  LEVEL_PARTIAL: 1,
  LEVEL_KNOWN: 2,
}));

import { openPanel, closePanel, isOpen, togglePanel, resetBookState } from '../src/vocab-browser.js';
import { getAllWords, setLevel, deleteAllWords, deleteWordsList, importVocab } from '../src/vocab-store.js';
import { getAllBookWords, getIframeDocument } from '../src/epub-reader.js';

// ── Helpers ──────────────────────────────────────────────────────────

/** Return the vocab panel element. */
function panel() {
  return document.getElementById('vocab-panel');
}

/** Return the .vocab-list container inside the panel. */
function vocabList() {
  return panel()?.querySelector('.vocab-list');
}

/** Return all rendered word rows inside the panel. */
function wordRows() {
  return [...(vocabList()?.querySelectorAll('.vb-word-row') ?? [])];
}

/** Return text content of .vocab-summary. */
function summaryText() {
  return panel()?.querySelector('.vocab-summary')?.textContent ?? '';
}

/** Click a filter button by its data-filter value. */
function clickFilter(filterValue) {
  const btn = panel().querySelector(`.vocab-lvl-btn[data-filter="${filterValue}"]`);
  btn.click();
}

/** Type into the search input and dispatch an input event. */
function typeSearch(query) {
  const input = panel().querySelector('.vocab-search');
  input.value = query;
  input.dispatchEvent(new Event('input'));
}

/** Simulate clicking a word row by data-word attribute. */
function clickWordRow(word) {
  const row = panel().querySelector(`.vb-word-row[data-word="${CSS.escape(word)}"]`);
  row.click();
}

/** Return badge text for a given word row. */
function badgeText(word) {
  const row = panel().querySelector(`.vb-word-row[data-word="${CSS.escape(word)}"]`);
  return row?.querySelector('.vb-badge')?.textContent ?? null;
}

/** Return the badge CSS class list for a given word row. */
function badgeClasses(word) {
  const row = panel().querySelector(`.vb-word-row[data-word="${CSS.escape(word)}"]`);
  return [...(row?.querySelector('.vb-badge')?.classList ?? [])];
}

/** Click a group mark button inside the group for a given stem key. */
function clickGroupMark(stemKey, level) {
  const group = panel().querySelector(`.vb-group[data-stem="${CSS.escape(stemKey)}"]`);
  const btn = group.querySelector(`.vb-group-mark[data-level="${level}"]`);
  btn.click();
}

/** Wait for pending microtasks / promises to settle. */
function flush() {
  return new Promise(r => setTimeout(r, 0));
}

/**
 * Reset module-level UI state between tests.
 *
 * openPanel now resets inBookOnly when the book changes, and syncs
 * the checkbox to book state. But activeFilter persists, so we
 * reset that via the DOM. We also call resetBookState to clear
 * bookWordSet/lastBookId so each test starts clean.
 */
function resetPanelFilters() {
  const p = panel();
  if (!p) return;

  // Reset activeFilter to 'all' by clicking the All button
  const allBtn = p.querySelector('.vocab-lvl-btn[data-filter="all"]');
  if (allBtn && !allBtn.classList.contains('active')) {
    allBtn.click();
  }

  // Reset book state via the exported function (clears bookWordSet,
  // lastBookId, inBookOnly). openPanel will re-sync from these.
  resetBookState();
}

// ── Setup ────────────────────────────────────────────────────────────

// Set up the DOM shell once. The panel will be appended here by
// ensurePanel() on the first openPanel call and stays for all tests.
beforeAll(() => {
  document.body.innerHTML = `
    <div id="app">
      <main class="main-area">
        <div id="toc-panel"></div>
      </main>
    </div>
  `;
});

beforeEach(async () => {
  vi.clearAllMocks();

  // Remove any lingering undo toasts
  document.querySelectorAll('.undo-toast').forEach(el => el.remove());

  // Ensure toc-panel has no leftover classes
  const tocPanel = document.getElementById('toc-panel');
  if (tocPanel) tocPanel.classList.remove('open');

  // Reset filter/book state via DOM controls, then close the panel
  resetPanelFilters();
  await flush();
  closePanel();
});

// ── Subdomain: Panel Lifecycle ───────────────────────────────────────

describe('Panel lifecycle', () => {
  it('isOpen returns false when panel is closed', () => {
    expect(isOpen()).toBe(false);
  });

  it('openPanel creates the panel DOM and adds the open class', async () => {
    await openPanel('en');
    expect(panel()).not.toBeNull();
    expect(panel().classList.contains('open')).toBe(true);
    expect(isOpen()).toBe(true);
  });

  it('openPanel calls getAllWords with the given language', async () => {
    await openPanel('fr');
    expect(getAllWords).toHaveBeenCalledWith('fr');
  });

  it('openPanel closes the toc-panel if it has the open class', async () => {
    document.getElementById('toc-panel').classList.add('open');
    await openPanel('en');
    expect(document.getElementById('toc-panel').classList.contains('open')).toBe(false);
  });

  it('openPanel resets the search input', async () => {
    await openPanel('en');
    typeSearch('hello');
    await openPanel('en');
    const input = panel().querySelector('.vocab-search');
    expect(input.value).toBe('');
  });

  it('closePanel removes the open class', async () => {
    await openPanel('en');
    closePanel();
    expect(panel().classList.contains('open')).toBe(false);
    expect(isOpen()).toBe(false);
  });

  it('closePanel is safe to call when panel is already closed', () => {
    expect(() => closePanel()).not.toThrow();
  });

  it('togglePanel opens when closed', async () => {
    expect(isOpen()).toBe(false);
    togglePanel('en');
    await flush();
    expect(isOpen()).toBe(true);
  });

  it('togglePanel closes when open', async () => {
    await openPanel('en');
    expect(isOpen()).toBe(true);
    togglePanel('en');
    expect(isOpen()).toBe(false);
  });

  it('close button click closes the panel', async () => {
    await openPanel('en');
    panel().querySelector('.vocab-close-btn').click();
    expect(isOpen()).toBe(false);
  });

  it('panel is appended inside .main-area', async () => {
    await openPanel('en');
    expect(document.querySelector('.main-area #vocab-panel')).not.toBeNull();
  });

  it('ensurePanel reuses existing panel on subsequent openPanel calls', async () => {
    await openPanel('en');
    const firstPanel = panel();
    await openPanel('en');
    expect(panel()).toBe(firstPanel);
  });
});

// ── Subdomain: Rendering word list ───────────────────────────────────

describe('Rendering word list', () => {
  it('renders word rows for each DB word', async () => {
    getAllWords.mockResolvedValueOnce([
      { word: 'cat', level: 1 },
      { word: 'dog', level: 2 },
    ]);
    await openPanel('en');
    const rows = wordRows();
    expect(rows.length).toBe(2);
    const words = rows.map(r => r.dataset.word).sort();
    expect(words).toEqual(['cat', 'dog']);
  });

  it('shows empty state message when no words are saved (DB mode)', async () => {
    getAllWords.mockResolvedValueOnce([]);
    await openPanel('en');
    const empty = vocabList().querySelector('.vb-empty');
    expect(empty).not.toBeNull();
    expect(empty.textContent).toContain('No vocabulary saved yet');
  });

  it('displays correct badge symbols for each level', async () => {
    getAllWords.mockResolvedValueOnce([
      { word: 'alpha', level: 1 },
      { word: 'beta', level: 2 },
    ]);
    await openPanel('en');
    expect(badgeText('alpha')).toBe('~');
    expect(badgeText('beta')).toBe('\u2713');
  });

  it('displays correct badge CSS classes for each level', async () => {
    getAllWords.mockResolvedValueOnce([
      { word: 'alpha', level: 1 },
      { word: 'beta', level: 2 },
    ]);
    await openPanel('en');
    expect(badgeClasses('alpha')).toContain('vb-partial');
    expect(badgeClasses('beta')).toContain('vb-known');
  });

  it('shows summary with word count', async () => {
    getAllWords.mockResolvedValueOnce([
      { word: 'cat', level: 1 },
      { word: 'dog', level: 2 },
      { word: 'bird', level: 1 },
    ]);
    await openPanel('en');
    expect(summaryText()).toContain('3 words');
  });

  it('uses singular "word" for a single word', async () => {
    getAllWords.mockResolvedValueOnce([{ word: 'cat', level: 1 }]);
    await openPanel('en');
    expect(summaryText()).toContain('1 word');
    expect(summaryText()).not.toContain('1 words');
  });
});

// ── Subdomain: Filtering by level ────────────────────────────────────

describe('Filtering by level', () => {
  beforeEach(async () => {
    getAllWords.mockResolvedValueOnce([
      { word: 'alpha', level: 1 },
      { word: 'beta', level: 2 },
      { word: 'gamma', level: 1 },
    ]);
    await openPanel('en');
  });

  it('"All" filter shows all words', () => {
    clickFilter('all');
    expect(wordRows().length).toBe(3);
  });

  it('level 1 filter shows only partial words', () => {
    clickFilter('1');
    const rows = wordRows();
    expect(rows.length).toBe(2);
    const words = rows.map(r => r.dataset.word).sort();
    expect(words).toEqual(['alpha', 'gamma']);
  });

  it('level 2 filter shows only known words', () => {
    clickFilter('2');
    const rows = wordRows();
    expect(rows.length).toBe(1);
    expect(rows[0].dataset.word).toBe('beta');
  });

  it('level 0 filter in DB mode shows explanatory message', () => {
    clickFilter('0');
    const empty = vocabList().querySelector('.vb-empty');
    expect(empty).not.toBeNull();
    expect(empty.textContent).toContain('In this book');
  });

  it('clicking a filter button marks it as active and deactivates others', () => {
    clickFilter('1');
    const btn = panel().querySelector('.vocab-lvl-btn[data-filter="1"]');
    expect(btn.classList.contains('active')).toBe(true);
    const allBtn = panel().querySelector('.vocab-lvl-btn[data-filter="all"]');
    expect(allBtn.classList.contains('active')).toBe(false);
  });

  it('shows "No words match" when search yields no results', () => {
    clickFilter('all');
    typeSearch('zzzzz');
    const empty = vocabList().querySelector('.vb-empty');
    expect(empty).not.toBeNull();
    expect(empty.textContent).toContain('No words match');
  });
});

// ── Subdomain: Search filtering ──────────────────────────────────────

describe('Search filtering', () => {
  beforeEach(async () => {
    getAllWords.mockResolvedValueOnce([
      { word: 'apple', level: 1 },
      { word: 'application', level: 2 },
      { word: 'banana', level: 1 },
    ]);
    await openPanel('en');
  });

  it('filters words by substring match', () => {
    typeSearch('app');
    const rows = wordRows();
    const words = rows.map(r => r.dataset.word).sort();
    expect(words).toEqual(['apple', 'application']);
  });

  it('search is case-insensitive', () => {
    typeSearch('APP');
    const rows = wordRows();
    expect(rows.length).toBe(2);
  });

  it('search trims whitespace', () => {
    typeSearch('  banana  ');
    const rows = wordRows();
    expect(rows.length).toBe(1);
    expect(rows[0].dataset.word).toBe('banana');
  });

  it('empty search shows all words', () => {
    typeSearch('app');
    expect(wordRows().length).toBe(2);
    typeSearch('');
    expect(wordRows().length).toBe(3);
  });

  it('search combines with level filter', () => {
    clickFilter('1');
    typeSearch('app');
    const rows = wordRows();
    expect(rows.length).toBe(1);
    expect(rows[0].dataset.word).toBe('apple');
  });
});

// ── Subdomain: Stem grouping ─────────────────────────────────────────

describe('Stem grouping', () => {
  // Verified stems: walked/walking -> "wal", tested/testing -> "tes",
  // asked/asking/asks -> "ask", teachers/teacher/teaching -> "teach",
  // cats/cat -> "cat" (both the same)

  it('groups words that share the same stem', async () => {
    // "tested" -> "tes", "testing" -> "tes" (both share stem)
    getAllWords.mockResolvedValueOnce([
      { word: 'tested', level: 1 },
      { word: 'testing', level: 2 },
    ]);
    await openPanel('en');
    const groups = vocabList().querySelectorAll('.vb-group');
    expect(groups.length).toBe(1);
    const groupBody = groups[0].querySelector('.vb-group-body');
    const groupRows = groupBody.querySelectorAll('.vb-word-row');
    expect(groupRows.length).toBe(2);
  });

  it('renders single-word stems as flat rows (no group wrapper)', async () => {
    getAllWords.mockResolvedValueOnce([
      { word: 'cat', level: 1 },
      { word: 'dog', level: 2 },
    ]);
    await openPanel('en');
    const groups = vocabList().querySelectorAll('.vb-group');
    expect(groups.length).toBe(0);
    const flatRows = vocabList().querySelectorAll('.vb-flat-row');
    expect(flatRows.length).toBe(2);
  });

  it('multi-word groups appear before single-word entries', async () => {
    // "asked" -> "ask", "asking" -> "ask" (group of 2)
    // "zebra" -> "zebra" (single entry)
    getAllWords.mockResolvedValueOnce([
      { word: 'zebra', level: 1 },
      { word: 'asked', level: 1 },
      { word: 'asking', level: 1 },
    ]);
    await openPanel('en');
    const children = vocabList().children;
    // First child should be the group (asked/asking)
    expect(children[0].classList.contains('vb-group')).toBe(true);
    // Second child should be the flat row (zebra)
    expect(children[1].classList.contains('vb-flat-row')).toBe(true);
  });

  it('groups show word count in header', async () => {
    // "asked" -> "ask", "asking" -> "ask", "asks" -> "ask" (group of 3)
    getAllWords.mockResolvedValueOnce([
      { word: 'asked', level: 1 },
      { word: 'asking', level: 1 },
      { word: 'asks', level: 1 },
    ]);
    await openPanel('en');
    const countEl = vocabList().querySelector('.vb-group-count');
    expect(countEl.textContent).toBe('3');
  });

  it('summary mentions group count when multi-word groups exist', async () => {
    // "tested"/"testing" -> "tes" (group of 2), "cat" is single
    getAllWords.mockResolvedValueOnce([
      { word: 'tested', level: 1 },
      { word: 'testing', level: 1 },
      { word: 'cat', level: 1 },
    ]);
    await openPanel('en');
    expect(summaryText()).toContain('1 group');
  });

  it('words within a group are sorted alphabetically', async () => {
    getAllWords.mockResolvedValueOnce([
      { word: 'testing', level: 1 },
      { word: 'tested', level: 1 },
    ]);
    await openPanel('en');
    const rows = vocabList().querySelectorAll('.vb-group .vb-word-row');
    expect(rows[0].dataset.word).toBe('tested');
    expect(rows[1].dataset.word).toBe('testing');
  });

  it('group header toggles collapsed state on click', async () => {
    getAllWords.mockResolvedValueOnce([
      { word: 'tested', level: 1 },
      { word: 'testing', level: 2 },
    ]);
    await openPanel('en');
    const group = vocabList().querySelector('.vb-group');
    const header = group.querySelector('.vb-group-header');
    expect(group.classList.contains('collapsed')).toBe(false);
    header.click();
    expect(group.classList.contains('collapsed')).toBe(true);
    header.click();
    expect(group.classList.contains('collapsed')).toBe(false);
  });

  it('groups are sorted by size descending, then alphabetically', async () => {
    // "asked"/"asking"/"asks" -> "ask" (group of 3)
    // "tested"/"testing" -> "tes" (group of 2)
    // "ask" group has 3 words, "tes" group has 2 — ask first
    getAllWords.mockResolvedValueOnce([
      { word: 'tested', level: 1 },
      { word: 'testing', level: 1 },
      { word: 'asked', level: 1 },
      { word: 'asking', level: 1 },
      { word: 'asks', level: 1 },
    ]);
    await openPanel('en');
    const groups = vocabList().querySelectorAll('.vb-group');
    expect(groups.length).toBe(2);
    const firstGroupWords = groups[0].querySelectorAll('.vb-word-row');
    expect(firstGroupWords.length).toBe(3);
    const secondGroupWords = groups[1].querySelectorAll('.vb-word-row');
    expect(secondGroupWords.length).toBe(2);
  });
});

// ── Subdomain: Word cycling ──────────────────────────────────────────

describe('Word cycling', () => {
  it('cycles word level 1 -> 2 and updates badge', async () => {
    getAllWords.mockResolvedValueOnce([{ word: 'cat', level: 1 }]);
    await openPanel('en');
    expect(badgeText('cat')).toBe('~');
    expect(badgeClasses('cat')).toContain('vb-partial');

    clickWordRow('cat');
    await flush();

    expect(badgeText('cat')).toBe('\u2713');
    expect(badgeClasses('cat')).toContain('vb-known');
  });

  it('cycles word level 2 -> 0 and updates badge', async () => {
    getAllWords.mockResolvedValueOnce([{ word: 'dog', level: 2 }]);
    await openPanel('en');
    expect(badgeText('dog')).toBe('\u2713');

    clickWordRow('dog');
    await flush();

    expect(badgeText('dog')).toBe('?');
    expect(badgeClasses('dog')).toContain('vb-unknown');
  });

  it('calls setLevel with the correct language, word, and new level', async () => {
    getAllWords.mockResolvedValueOnce([{ word: 'chat', level: 1 }]);
    await openPanel('fr');
    vi.clearAllMocks();

    clickWordRow('chat');
    await flush();

    expect(setLevel).toHaveBeenCalledWith('fr', 'chat', 2);
  });

  it('invokes statsCallback when a word is cycled', async () => {
    const statsCallback = vi.fn();
    getAllWords.mockResolvedValueOnce([{ word: 'cat', level: 1 }]);
    await openPanel('en', { onStatsUpdate: statsCallback });
    vi.clearAllMocks();

    clickWordRow('cat');
    await flush();

    expect(statsCallback).toHaveBeenCalled();
  });

  it('full cycle: 1 -> 2 -> 0 -> 1', async () => {
    getAllWords.mockResolvedValueOnce([{ word: 'test', level: 1 }]);
    await openPanel('en');

    // 1 -> 2
    clickWordRow('test');
    await flush();
    expect(badgeText('test')).toBe('\u2713');

    // 2 -> 0
    clickWordRow('test');
    await flush();
    expect(badgeText('test')).toBe('?');

    // 0 -> 1
    clickWordRow('test');
    await flush();
    expect(badgeText('test')).toBe('~');
  });
});

// ── Subdomain: Group marking ─────────────────────────────────────────

describe('Group marking', () => {
  // Use "tested"/"testing" which both stem to "tes"

  it('marks all words in a group to the target level', async () => {
    getAllWords.mockResolvedValueOnce([
      { word: 'tested', level: 1 },
      { word: 'testing', level: 1 },
    ]);
    await openPanel('en');

    expect(badgeClasses('tested')).toContain('vb-partial');
    expect(badgeClasses('testing')).toContain('vb-partial');

    // Stem key is "tes"
    clickGroupMark('tes', 2);
    await flush();

    expect(badgeClasses('tested')).toContain('vb-known');
    expect(badgeClasses('testing')).toContain('vb-known');
  });

  it('calls setLevel for each word in the group', async () => {
    getAllWords.mockResolvedValueOnce([
      { word: 'tested', level: 1 },
      { word: 'testing', level: 1 },
    ]);
    await openPanel('en');
    vi.clearAllMocks();

    clickGroupMark('tes', 2);
    await flush();

    expect(setLevel).toHaveBeenCalledWith('en', 'tested', 2);
    expect(setLevel).toHaveBeenCalledWith('en', 'testing', 2);
  });

  it('does not call setLevel for words already at the target level', async () => {
    getAllWords.mockResolvedValueOnce([
      { word: 'tested', level: 2 },
      { word: 'testing', level: 1 },
    ]);
    await openPanel('en');
    vi.clearAllMocks();

    clickGroupMark('tes', 2);
    await flush();

    // Only "testing" changes (tested is already level 2)
    expect(setLevel).toHaveBeenCalledTimes(1);
    expect(setLevel).toHaveBeenCalledWith('en', 'testing', 2);
  });

  it('shows undo toast after marking a group', async () => {
    getAllWords.mockResolvedValueOnce([
      { word: 'tested', level: 1 },
      { word: 'testing', level: 1 },
    ]);
    await openPanel('en');

    clickGroupMark('tes', 2);
    await flush();

    const toast = document.querySelector('.undo-toast');
    expect(toast).not.toBeNull();
    expect(toast.textContent).toContain('Marked 2 words');
  });

  it('undo restores previous word levels', async () => {
    getAllWords.mockResolvedValueOnce([
      { word: 'tested', level: 1 },
      { word: 'testing', level: 1 },
    ]);
    await openPanel('en');

    clickGroupMark('tes', 2);
    await flush();

    expect(badgeClasses('tested')).toContain('vb-known');
    expect(badgeClasses('testing')).toContain('vb-known');

    // Click undo
    const undoBtn = document.querySelector('.undo-btn');
    undoBtn.click();
    await flush();

    expect(badgeClasses('tested')).toContain('vb-partial');
    expect(badgeClasses('testing')).toContain('vb-partial');
  });

  it('invokes statsCallback when a group is marked', async () => {
    const statsCallback = vi.fn();
    getAllWords.mockResolvedValueOnce([
      { word: 'tested', level: 1 },
      { word: 'testing', level: 1 },
    ]);
    await openPanel('en', { onStatsUpdate: statsCallback });
    vi.clearAllMocks();

    clickGroupMark('tes', 2);
    await flush();

    expect(statsCallback).toHaveBeenCalled();
  });

  it('group has both partial and known mark buttons', async () => {
    getAllWords.mockResolvedValueOnce([
      { word: 'tested', level: 1 },
      { word: 'testing', level: 1 },
    ]);
    await openPanel('en');

    const group = vocabList().querySelector('.vb-group');
    const markBtns = group.querySelectorAll('.vb-group-mark');
    expect(markBtns.length).toBe(2);
    const levels = [...markBtns].map(b => b.dataset.level).sort();
    expect(levels).toEqual(['1', '2']);
  });
});

// ── Subdomain: Event delegation ──────────────────────────────────────

describe('Event delegation', () => {
  it('mark button click does not trigger header collapse', async () => {
    getAllWords.mockResolvedValueOnce([
      { word: 'tested', level: 1 },
      { word: 'testing', level: 1 },
    ]);
    await openPanel('en');

    const group = vocabList().querySelector('.vb-group');
    expect(group.classList.contains('collapsed')).toBe(false);

    // Click the mark button (nested inside the header).
    // The event delegation checks markBtn BEFORE header,
    // so it should return early without toggling collapse.
    clickGroupMark('tes', 2);
    await flush();

    expect(group.classList.contains('collapsed')).toBe(false);
  });

  it('clicking outside word rows and headers does nothing', async () => {
    getAllWords.mockResolvedValueOnce([{ word: 'cat', level: 1 }]);
    await openPanel('en');

    // Click the vocab-list container itself (not a row or header)
    vocabList().click();
    await flush();

    // State should be unchanged
    expect(badgeText('cat')).toBe('~');
  });

  it('clicking a word row in a group cycles that word only', async () => {
    getAllWords.mockResolvedValueOnce([
      { word: 'tested', level: 1 },
      { word: 'testing', level: 1 },
    ]);
    await openPanel('en');

    clickWordRow('tested');
    await flush();

    expect(badgeClasses('tested')).toContain('vb-known');
    expect(badgeClasses('testing')).toContain('vb-partial');
  });
});

// ── Subdomain: Forget operations ─────────────────────────────────────

describe('Forget all words', () => {
  it('clears the word list after forget-all', async () => {
    getAllWords.mockResolvedValueOnce([
      { word: 'cat', level: 1 },
      { word: 'dog', level: 2 },
    ]);
    deleteAllWords.mockResolvedValueOnce([
      { language: 'en', word: 'cat', level: 1 },
      { language: 'en', word: 'dog', level: 2 },
    ]);
    await openPanel('en');
    expect(wordRows().length).toBe(2);

    const forgetBtn = panel().querySelector('.vocab-forget-btn[data-scope="all"]');
    forgetBtn.click();
    await flush();

    const empty = vocabList().querySelector('.vb-empty');
    expect(empty).not.toBeNull();
  });

  it('calls deleteAllWords with the current language', async () => {
    getAllWords.mockResolvedValueOnce([{ word: 'cat', level: 1 }]);
    deleteAllWords.mockResolvedValueOnce([
      { language: 'en', word: 'cat', level: 1 },
    ]);
    await openPanel('en');
    vi.clearAllMocks();

    const forgetBtn = panel().querySelector('.vocab-forget-btn[data-scope="all"]');
    forgetBtn.click();
    await flush();

    expect(deleteAllWords).toHaveBeenCalledWith('en');
  });

  it('shows undo toast after forgetting all', async () => {
    getAllWords.mockResolvedValueOnce([
      { word: 'cat', level: 1 },
      { word: 'dog', level: 2 },
    ]);
    deleteAllWords.mockResolvedValueOnce([
      { language: 'en', word: 'cat', level: 1 },
      { language: 'en', word: 'dog', level: 2 },
    ]);
    await openPanel('en');

    const forgetBtn = panel().querySelector('.vocab-forget-btn[data-scope="all"]');
    forgetBtn.click();
    await flush();

    const toast = document.querySelector('.undo-toast');
    expect(toast).not.toBeNull();
    expect(toast.textContent).toContain('Forgot 2 words');
  });

  it('undo after forget-all restores words via importVocab', async () => {
    const deleted = [
      { language: 'en', word: 'cat', level: 1 },
      { language: 'en', word: 'dog', level: 2 },
    ];
    getAllWords.mockResolvedValueOnce([
      { word: 'cat', level: 1 },
      { word: 'dog', level: 2 },
    ]);
    deleteAllWords.mockResolvedValueOnce(deleted);
    await openPanel('en');

    const forgetBtn = panel().querySelector('.vocab-forget-btn[data-scope="all"]');
    forgetBtn.click();
    await flush();

    vi.clearAllMocks();
    const undoBtn = document.querySelector('.undo-btn');
    undoBtn.click();
    await flush();

    expect(importVocab).toHaveBeenCalledWith(deleted);
  });

  it('does nothing when deleteAllWords returns empty', async () => {
    getAllWords.mockResolvedValueOnce([]);
    deleteAllWords.mockResolvedValueOnce([]);
    await openPanel('en');

    const forgetBtn = panel().querySelector('.vocab-forget-btn[data-scope="all"]');
    forgetBtn.click();
    await flush();

    const toast = document.querySelector('.undo-toast');
    expect(toast).toBeNull();
  });

  it('invokes statsCallback after forget-all', async () => {
    const statsCallback = vi.fn();
    getAllWords.mockResolvedValueOnce([{ word: 'cat', level: 1 }]);
    deleteAllWords.mockResolvedValueOnce([
      { language: 'en', word: 'cat', level: 1 },
    ]);
    await openPanel('en', { onStatsUpdate: statsCallback });
    vi.clearAllMocks();

    const forgetBtn = panel().querySelector('.vocab-forget-btn[data-scope="all"]');
    forgetBtn.click();
    await flush();

    expect(statsCallback).toHaveBeenCalled();
  });
});

describe('Forget book words', () => {
  it('forget-in-book button is disabled by default', async () => {
    await openPanel('en');
    const btn = panel().querySelector('.vocab-forget-btn[data-scope="book"]');
    expect(btn.disabled).toBe(true);
  });

  it('clicking disabled forget-in-book button does nothing', async () => {
    await openPanel('en');
    const btn = panel().querySelector('.vocab-forget-btn[data-scope="book"]');
    btn.click();
    await flush();
    expect(deleteWordsList).not.toHaveBeenCalled();
  });

  it('forget-in-book is enabled when in-book mode is active with scanned words', async () => {
    const bookWords = new Set(['cat', 'dog']);
    getAllBookWords.mockResolvedValueOnce(bookWords);
    getAllWords.mockResolvedValueOnce([{ word: 'cat', level: 1 }]);
    await openPanel('en', { bookId: 'book-forget-1' });

    // Auto-enabled: book mode active, scan complete → button should be enabled
    const btn = panel().querySelector('.vocab-forget-btn[data-scope="book"]');
    expect(btn.disabled).toBe(false);
  });

  it('forget-in-book calls deleteWordsList with book words', async () => {
    const bookWords = new Set(['cat', 'dog']);
    getAllBookWords.mockResolvedValueOnce(bookWords);
    getAllWords.mockResolvedValueOnce([
      { word: 'cat', level: 1 },
      { word: 'dog', level: 2 },
    ]);
    deleteWordsList.mockResolvedValueOnce([
      { language: 'en', word: 'cat', level: 1 },
      { language: 'en', word: 'dog', level: 2 },
    ]);
    await openPanel('en', { bookId: 'book-forget-2' });

    vi.clearAllMocks();
    const forgetBtn = panel().querySelector('.vocab-forget-btn[data-scope="book"]');
    forgetBtn.click();
    await flush();

    expect(deleteWordsList).toHaveBeenCalledWith('en', ['cat', 'dog']);
  });

  it('shows undo toast after forgetting book words', async () => {
    const bookWords = new Set(['cat']);
    getAllBookWords.mockResolvedValueOnce(bookWords);
    getAllWords.mockResolvedValueOnce([{ word: 'cat', level: 1 }]);
    deleteWordsList.mockResolvedValueOnce([
      { language: 'en', word: 'cat', level: 1 },
    ]);
    await openPanel('en', { bookId: 'book-forget-3' });

    const forgetBtn = panel().querySelector('.vocab-forget-btn[data-scope="book"]');
    forgetBtn.click();
    await flush();

    const toast = document.querySelector('.undo-toast');
    expect(toast).not.toBeNull();
    expect(toast.textContent).toContain('Forgot 1 words in book');
  });
});

// ── Subdomain: In-book mode ──────────────────────────────────────────
//
// NOTE: bookWordSet is module-level state that persists once set.
// The first test that enables "In this book" and triggers a scan will
// set bookWordSet permanently. Subsequent tests reuse it unless they
// run before bookWordSet is set. We structure these tests to account
// for this persistent state.

describe('In-book mode', () => {
  // These tests simulate a book being loaded by mocking isBookLoaded
  // and getBookId. When a book is detected, openPanel auto-enables
  // "In this book" mode and triggers a scan, so the user sees book
  // words immediately.

  it('book toggle is disabled when no book is loaded', async () => {
    getAllWords.mockResolvedValueOnce([]);
    await openPanel('en'); // no bookId → no book

    const bookCb = panel().querySelector('.vocab-book-cb');
    expect(bookCb.disabled).toBe(true);
    const statusEl = panel().querySelector('.vocab-scan-status');
    expect(statusEl.textContent).toBe('No book open');
  });

  it('auto-enables book mode and scans when a book is loaded', async () => {
    const bookWords = new Set(['hello', 'world']);
    getAllBookWords.mockResolvedValueOnce(bookWords);
    getAllWords.mockResolvedValueOnce([]);
    await openPanel('en', { bookId: 'book-1' });

    // Checkbox should be auto-checked and enabled
    const bookCb = panel().querySelector('.vocab-book-cb');
    expect(bookCb.disabled).toBe(false);
    expect(bookCb.checked).toBe(true);

    // Book words should appear immediately without manual toggle
    const rows = wordRows();
    expect(rows.length).toBe(2);
    const words = rows.map(r => r.dataset.word).sort();
    expect(words).toEqual(['hello', 'world']);
  });

  it('shows book words including unknown (level 0) in book mode', async () => {
    const bookWords = new Set(['alpha', 'beta', 'gamma']);
    getAllBookWords.mockResolvedValueOnce(bookWords);
    getAllWords.mockResolvedValueOnce([
      { word: 'alpha', level: 1 },
    ]);
    await openPanel('en', { bookId: 'book-2' });

    // All 3 book words shown: alpha (level 1), beta (level 0), gamma (level 0)
    expect(wordRows().length).toBe(3);
  });

  it('level 0 filter shows unknown words in book mode', async () => {
    const bookWords = new Set(['known', 'mystery']);
    getAllBookWords.mockResolvedValueOnce(bookWords);
    getAllWords.mockResolvedValueOnce([
      { word: 'known', level: 2 },
    ]);
    await openPanel('en', { bookId: 'book-3' });

    clickFilter('0');
    const unknownRows = wordRows();
    expect(unknownRows.length).toBe(1);
    expect(unknownRows[0].dataset.word).toBe('mystery');
  });

  it('unchecking book toggle reverts to DB-only mode', async () => {
    const bookWords = new Set(['hello', 'world']);
    getAllBookWords.mockResolvedValueOnce(bookWords);
    getAllWords.mockResolvedValueOnce([
      { word: 'hello', level: 1 },
    ]);
    await openPanel('en', { bookId: 'book-4' });

    // Auto-enabled: should show both book words
    expect(wordRows().length).toBe(2);

    // User unchecks → DB-only
    const bookCb = panel().querySelector('.vocab-book-cb');
    bookCb.checked = false;
    bookCb.dispatchEvent(new Event('change'));
    await flush();

    expect(wordRows().length).toBe(1);
    expect(wordRows()[0].dataset.word).toBe('hello');
  });

  it('does not re-scan when bookWordSet already exists for same book', async () => {
    const bookWords = new Set(['cat']);
    getAllBookWords.mockResolvedValueOnce(bookWords);
    getAllWords.mockResolvedValueOnce([]);
    await openPanel('en', { bookId: 'book-5' });

    // openPanel auto-scanned
    expect(getAllBookWords).toHaveBeenCalledTimes(1);
    vi.clearAllMocks();

    // Close and reopen with same book — should not re-scan
    closePanel();
    getAllWords.mockResolvedValueOnce([]);
    await openPanel('en', { bookId: 'book-5' });

    expect(getAllBookWords).not.toHaveBeenCalled();
    expect(wordRows().length).toBe(1);
  });

  it('invalidates bookWordSet when book changes', async () => {
    const bookWordsA = new Set(['apple']);
    getAllBookWords.mockResolvedValueOnce(bookWordsA);
    getAllWords.mockResolvedValueOnce([]);
    await openPanel('en', { bookId: 'book-A' });

    expect(wordRows().length).toBe(1);
    expect(wordRows()[0].dataset.word).toBe('apple');

    // Close, switch to book B
    closePanel();
    resetBookState();
    const bookWordsB = new Set(['banana', 'berry']);
    getAllBookWords.mockResolvedValueOnce(bookWordsB);
    getAllWords.mockResolvedValueOnce([]);
    await openPanel('en', { bookId: 'book-B' });

    // openPanel auto-scans book B
    expect(wordRows().length).toBe(2);
    const words = wordRows().map(r => r.dataset.word).sort();
    expect(words).toEqual(['banana', 'berry']);
  });

  it('displays scan status with word count after scan', async () => {
    const bookWords = new Set(['one', 'two', 'three']);
    getAllBookWords.mockResolvedValueOnce(bookWords);
    getAllWords.mockResolvedValueOnce([]);
    await openPanel('en', { bookId: 'book-6' });

    const statusEl = panel().querySelector('.vocab-scan-status');
    expect(statusEl.textContent).toBe('3 unique');
  });
});

// ── Subdomain: Undo toast behavior ───────────────────────────────────

describe('Undo toast', () => {
  it('replaces existing toast when a new one is shown', async () => {
    // "tested"/"testing" -> stem "tes", "asked"/"asking" -> stem "ask"
    getAllWords.mockResolvedValueOnce([
      { word: 'tested', level: 1 },
      { word: 'testing', level: 1 },
      { word: 'asked', level: 1 },
      { word: 'asking', level: 1 },
    ]);
    await openPanel('en');

    // Mark first group
    clickGroupMark('tes', 2);
    await flush();
    expect(document.querySelectorAll('.undo-toast').length).toBe(1);

    // Mark second group — should replace first toast
    clickGroupMark('ask', 2);
    await flush();
    expect(document.querySelectorAll('.undo-toast').length).toBe(1);
  });
});

// ── Subdomain: Reader span syncing ───────────────────────────────────

describe('Reader span syncing', () => {
  it('syncs iframe spans when a word is cycled', async () => {
    const iframeDoc = document.implementation.createHTMLDocument();
    const span = iframeDoc.createElement('span');
    span.className = 'hl-word hl-partial';
    span.dataset.word = 'cat';
    span.dataset.language = 'en';
    span.dataset.level = '1';
    iframeDoc.body.appendChild(span);

    getIframeDocument.mockReturnValue(iframeDoc);
    getAllWords.mockResolvedValueOnce([{ word: 'cat', level: 1 }]);
    await openPanel('en');

    clickWordRow('cat');
    await flush();

    expect(span.dataset.level).toBe('2');
    expect(span.classList.contains('hl-known')).toBe(true);
  });

  it('syncs all iframe spans when forget-all is used', async () => {
    const iframeDoc = document.implementation.createHTMLDocument();
    const span = iframeDoc.createElement('span');
    span.className = 'hl-word hl-partial';
    span.dataset.word = 'cat';
    span.dataset.language = 'en';
    span.dataset.level = '1';
    iframeDoc.body.appendChild(span);

    getIframeDocument.mockReturnValue(iframeDoc);
    getAllWords.mockResolvedValueOnce([{ word: 'cat', level: 1 }]);
    deleteAllWords.mockResolvedValueOnce([
      { language: 'en', word: 'cat', level: 1 },
    ]);
    await openPanel('en');

    const forgetBtn = panel().querySelector('.vocab-forget-btn[data-scope="all"]');
    forgetBtn.click();
    await flush();

    expect(span.dataset.level).toBe('0');
    expect(span.classList.contains('hl-unknown')).toBe(true);
  });
});

// ── Subdomain: Panel structure ───────────────────────────────────────

describe('Panel structure', () => {
  it('panel has all expected UI sections', async () => {
    await openPanel('en');
    expect(panel().querySelector('.vocab-header')).not.toBeNull();
    expect(panel().querySelector('.vocab-filters')).not.toBeNull();
    expect(panel().querySelector('.vocab-search')).not.toBeNull();
    expect(panel().querySelector('.vocab-level-btns')).not.toBeNull();
    expect(panel().querySelector('.vocab-book-toggle')).not.toBeNull();
    expect(panel().querySelector('.vocab-list')).not.toBeNull();
    expect(panel().querySelector('.vocab-summary')).not.toBeNull();
    expect(panel().querySelector('.vocab-actions')).not.toBeNull();
  });

  it('has four level filter buttons with correct labels', async () => {
    await openPanel('en');
    const btns = panel().querySelectorAll('.vocab-lvl-btn');
    expect(btns.length).toBe(4);
    const labels = [...btns].map(b => b.textContent.trim());
    expect(labels).toEqual(['All', '?', '~', '\u2713']);
  });

  it('"All" filter button is active by default', async () => {
    await openPanel('en');
    const allBtn = panel().querySelector('.vocab-lvl-btn[data-filter="all"]');
    expect(allBtn.classList.contains('active')).toBe(true);
  });

  it('search input has correct placeholder', async () => {
    await openPanel('en');
    const input = panel().querySelector('.vocab-search');
    expect(input.placeholder).toContain('Search words');
  });

  it('panel has correct id and class', async () => {
    await openPanel('en');
    expect(panel().id).toBe('vocab-panel');
    expect(panel().classList.contains('vocab-panel')).toBe(true);
  });
});
