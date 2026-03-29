/**
 * Vocabulary Browser: a slide-in panel that shows all saved vocab
 * for the current language, with grouping by stem, filtering by
 * level and book presence, and group-level bulk marking.
 *
 * ── UX State Machine ───────────────────────────────────────────
 *
 * The panel has four main states, determined by two booleans:
 *
 *   isBookLoaded()  ×  state.vocab.inBookOnly
 *   ───────────────────────────────────────────────────────────
 *   false × false   NO_BOOK       Book toggle disabled, "No book open".
 *                                 Shows saved words (level 1+2) from DB.
 *                                 Empty state: "No vocabulary saved yet."
 *
 *   true  × false   BOOK_DB_ONLY  Book toggle enabled but unchecked.
 *                                 Shows saved words (level 1+2) from DB.
 *                                 Same display as NO_BOOK but toggle is
 *                                 available for the user to activate.
 *
 *   true  × true    BOOK_ACTIVE   Book toggle checked. Scans the epub
 *     (state.vocab.bookWordSet                spine and shows ALL book words with
 *      is non-null)               their DB levels (default 0 = unknown).
 *                                 All filters including "?" work.
 *
 *   true  × true    BOOK_SCANNING Transient: scan in progress.
 *     (state.vocab.bookWordSet                Shows "Scanning…" / percentage.
 *      is null)                   Falls back to DB-only display until
 *                                 scan completes.
 *
 * ── State Lifecycle ────────────────────────────────────────────
 *
 * openPanel():
 *   ALWAYS resets:  state.vocab.searchQuery
 *   RESETS on book change (bookId !== state.vocab.lastBookId):
 *     state.vocab.bookWordSet, state.vocab.bookScanInProgress, state.vocab.inBookOnly
 *   AUTO-ENABLES when book loaded:
 *     state.vocab.inBookOnly = true, triggers scan if state.vocab.bookWordSet is null.
 *     User sees book words immediately without manual checkbox toggle.
 *   PRESERVES across re-opens of same book:
 *     state.vocab.bookWordSet (scan cache), state.vocab.activeFilter
 *   RECEIVES from caller (main.js):
 *     bookId — passed explicitly, not queried from epub-reader.
 *     getIframeDocument — callback for accessing reader iframe DOM.
 *     checkbox disabled/enabled, status text derived from bookId.
 *
 * closePanel():    Only hides the panel. All state preserved.
 * resetBookState(): Full wipe — call on book close.
 *
 * ── Visual Symbols ─────────────────────────────────────────────
 *
 *   Symbol  Level  CSS class    Meaning (user-facing)
 *   ───────────────────────────────────────────────────
 *   ?       0      vb-unknown   Unknown — haven't learned yet
 *   ~       1      vb-partial   Learning — recognized but not solid
 *   ✓       2      vb-known     Known — confident in this word
 *
 * These symbols appear in: filter buttons, word row badges, and
 * group mark buttons. The "?" filter only produces results in
 * BOOK_ACTIVE mode (DB doesn't store level-0 words).
 *
 * ── Event Delegation (vocab-list click handler) ────────────────
 *
 * Priority order (first match wins, then returns):
 *   1. .vb-group-mark  → markGroup() — bulk level change
 *   2. .vb-group-header → toggle collapsed — expand/collapse group
 *   3. .vb-word-row     → cycleWord() — cycle single word level
 *
 * Mark buttons are nested inside headers, so they MUST be checked
 * first to prevent a click on "~" from toggling the group closed.
 *
 * ── Data Model ─────────────────────────────────────────────────
 *
 * DB-only mode: state.vocab.displayWords = state.vocab.dbWords (level 1+2 only from IndexedDB).
 *   Level 0 words are not stored in the DB.
 * "In this book" mode: scans the full epub spine and builds a word list
 *   from the BOOK, then looks up each word's level from the DB (default 0).
 */
import { getAllWords, setLevel, deleteAllWords, deleteWordsList, importVocab, exportVocab } from './vocab-store.js';
import { getAllBookWords } from './epub-reader.js';
import { stem } from './stemmer.js';
import { LEVEL_PARTIAL, LEVEL_KNOWN, markAllKnown, restoreWordLevels } from './highlighter.js';
import { state } from './app-state.js';
import { escapeHtml, showUndoToast } from './ui-utils.js';

const LEVEL_CLASSES = ['vb-unknown', 'vb-partial', 'vb-known'];
const LEVEL_SYMBOLS = ['?', '~', '\u2713'];

// ── Helpers ──────────────────────────────────────────────────────────

const HL_CLASSES = ['hl-unknown', 'hl-partial', 'hl-known'];

/**
 * Keep state.vocab.dbWords array in sync after a word level change.
 * state.vocab.dbWords only holds level 1+2 entries (level 0 = not stored).
 */
function adjustDbEntry(word, level) {
  const idx = state.vocab.dbWords.findIndex(w => w.word === word);
  if (idx !== -1) {
    if (level === 0) {
      state.vocab.dbWords.splice(idx, 1);
    } else {
      state.vocab.dbWords[idx].level = level;
    }
  } else if (level !== 0) {
    state.vocab.dbWords.push({ word, level });
  }
}

/** Update a single word's spans in the reader iframe. */
function syncReaderSpans(word, level) {
  const iframeDoc = state.vocab.iframeDocGetter ? state.vocab.iframeDocGetter() : null;
  if (!iframeDoc) return;
  iframeDoc.querySelectorAll(`.hl-word[data-word="${CSS.escape(word)}"][data-language="${CSS.escape(state.currentLanguage)}"]`)
    .forEach(el => {
      el.dataset.level = level;
      el.className = `hl-word ${HL_CLASSES[level]}`;
    });
}

/** Bulk-update all reader spans to reflect current state.vocab.dbWords state. */
function syncAllReaderSpans() {
  const iframeDoc = state.vocab.iframeDocGetter ? state.vocab.iframeDocGetter() : null;
  if (!iframeDoc) return;
  const levelMap = new Map();
  for (const w of state.vocab.dbWords) levelMap.set(w.word, w.level);
  iframeDoc.querySelectorAll(`.hl-word[data-language="${CSS.escape(state.currentLanguage)}"]`)
    .forEach(el => {
      const level = levelMap.get(el.dataset.word) || 0;
      el.dataset.level = level;
      el.className = `hl-word ${HL_CLASSES[level]}`;
    });
}

// ── Panel DOM ────────────────────────────────────────────────────────

/**
 * Create the panel DOM (once). Appended inside .main-area.
 */
function ensurePanel() {
  if (state.vocab.panelEl) return state.vocab.panelEl;

  state.vocab.panelEl = document.createElement('div');
  state.vocab.panelEl.id = 'vocab-panel';
  state.vocab.panelEl.className = 'vocab-panel';
  state.vocab.panelEl.innerHTML = `
    <div class="vocab-header">
      <strong>Vocabulary</strong>
      <button class="toolbar-btn vocab-close-btn" aria-label="Close">\u2715</button>
    </div>
    <div class="vocab-filters">
      <input type="search" class="vocab-search input-full" placeholder="Search words\u2026" />
      <div class="vocab-level-btns">
        <button class="vocab-lvl-btn active" data-filter="all" title="Show all saved words">All</button>
        <button class="vocab-lvl-btn vb-unknown" data-filter="0" title="Unknown words (book mode only)">?</button>
        <button class="vocab-lvl-btn vb-partial" data-filter="1" title="Words you are learning">~</button>
        <button class="vocab-lvl-btn vb-known" data-filter="2" title="Words you know">\u2713</button>
      </div>
      <label class="vocab-book-toggle">
        <input type="checkbox" class="vocab-book-cb" disabled />
        <span class="vocab-book-label">In this book</span>
        <span class="vocab-scan-status">No book open</span>
      </label>
    </div>
    <div class="vocab-list"></div>
    <div class="vocab-summary"></div>
    <div class="vocab-actions">
      <button class="vocab-mark-page-btn" title="Mark every word on the current page as known (K)">Mark all words on this page as known</button>
      <button class="vocab-forget-btn" data-scope="book" disabled title="Forget saved words that appear in the current book">Forget in book</button>
      <button class="vocab-forget-btn" data-scope="all" title="Forget all saved words for this language">Forget all</button>
    </div>
    <div class="vocab-io">
      <button class="vocab-export-btn" title="Export vocabulary as JSON">&#128190; Export</button>
      <button class="vocab-import-btn" title="Import vocabulary from JSON">&#128194; Import</button>
      <input type="file" class="vocab-import-input" accept=".json" hidden />
    </div>
  `;

  state.vocab.panelEl.querySelector('.vocab-close-btn').addEventListener('click', closePanel);

  const searchInput = state.vocab.panelEl.querySelector('.vocab-search');
  searchInput.addEventListener('input', () => {
    state.vocab.searchQuery = searchInput.value.toLowerCase().trim();
    renderList();
  });

  state.vocab.panelEl.querySelector('.vocab-level-btns').addEventListener('click', (e) => {
    const btn = e.target.closest('.vocab-lvl-btn');
    if (!btn) return;
    const f = btn.dataset.filter;
    state.vocab.activeFilter = f === 'all' ? 'all' : parseInt(f, 10);
    state.vocab.panelEl.querySelectorAll('.vocab-lvl-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderList();
  });

  const bookCb = state.vocab.panelEl.querySelector('.vocab-book-cb');
  bookCb.addEventListener('change', async () => {
    state.vocab.inBookOnly = bookCb.checked;
    if (state.vocab.inBookOnly && !state.vocab.bookWordSet && !state.vocab.bookScanInProgress) {
      await scanBook();
    }
    updateForgetBookBtn();
    await rebuildDisplayWords();
    renderList();
  });

  state.vocab.panelEl.querySelector('.vocab-list').addEventListener('click', (e) => {
    // Check mark buttons BEFORE header — they're nested inside the header,
    // so checking header first would swallow the click with an early return.
    const markBtn = e.target.closest('.vb-group-mark');
    if (markBtn) {
      const level = parseInt(markBtn.dataset.level, 10);
      const stemKey = markBtn.closest('.vb-group').dataset.stem;
      markGroup(stemKey, level);
      return;
    }

    const header = e.target.closest('.vb-group-header');
    if (header) {
      header.closest('.vb-group').classList.toggle('collapsed');
      return;
    }

    const row = e.target.closest('.vb-word-row');
    if (row) {
      cycleWord(row.dataset.word);
    }
  });

  state.vocab.panelEl.querySelector('.vocab-mark-page-btn').addEventListener('click', async () => {
    const iframeDoc = state.vocab.iframeDocGetter ? state.vocab.iframeDocGetter() : null;
    if (!iframeDoc) return;
    const prev = await markAllKnown(iframeDoc);
    if (state.vocab.onStatsUpdate) state.vocab.onStatsUpdate();
    if (prev.length === 0) return;
    // Refresh the vocab list to reflect new levels
    state.vocab.dbWords = await getAllWords(state.currentLanguage);
    await rebuildDisplayWords();
    renderList();
    showUndoToast(`Marked ${prev.length} words as known`, async () => {
      await restoreWordLevels(iframeDoc, prev);
      if (state.vocab.onStatsUpdate) state.vocab.onStatsUpdate();
      state.vocab.dbWords = await getAllWords(state.currentLanguage);
      await rebuildDisplayWords();
      renderList();
    });
  });

  state.vocab.panelEl.querySelector('.vocab-actions').addEventListener('click', (e) => {
    const btn = e.target.closest('.vocab-forget-btn');
    if (!btn || btn.disabled) return;
    const scope = btn.dataset.scope;
    if (scope === 'all') forgetAllWords();
    if (scope === 'book') forgetBookWords();
  });

  // Export/Import buttons
  state.vocab.panelEl.querySelector('.vocab-export-btn').addEventListener('click', async () => {
    const data = await exportVocab(state.currentLanguage);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hilight-vocab-${state.currentLanguage}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  const importBtn = state.vocab.panelEl.querySelector('.vocab-import-btn');
  const importInput = state.vocab.panelEl.querySelector('.vocab-import-input');
  importBtn.addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await importVocab(data);
      state.vocab.dbWords = await getAllWords(state.currentLanguage);
      await rebuildDisplayWords();
      renderList();
      if (state.vocab.onStatsUpdate) state.vocab.onStatsUpdate();
    } catch (err) {
      console.error('Import failed:', err);
    }
    e.target.value = '';
  });

  document.querySelector('.main-area').appendChild(state.vocab.panelEl);
  return state.vocab.panelEl;
}

/**
 * Open the vocab browser panel.
 *
 * UX state on open:
 * - Search is cleared.
 * - Book toggle is enabled/disabled based on whether a book is loaded.
 * - If the book changed since last open, cached state.vocab.bookWordSet is invalidated
 *   and state.vocab.inBookOnly resets to false so the user starts fresh.
 * - If the same book is still open, previous in-book state is preserved
 *   so re-opening the panel feels seamless.
 * - When a book IS loaded, auto-enables "In this book" mode and scans
 *   if needed, so the user sees book words immediately without having
 *   to discover and toggle a checkbox.
 *
 * Book state is passed explicitly by the caller (main.js) via the
 * options.bookId parameter. This avoids cross-module state queries
 * that are invisible to tests and hard to debug at runtime.
 */
export async function openPanel(language, { bookId = null, onStatsUpdate: statsCallback = null, getIframeDocument: getIframeDocFn = null } = {}) {
  state.currentLanguage = language;
  state.vocab.onStatsUpdate = statsCallback || null;
  state.vocab.iframeDocGetter = getIframeDocFn || null;
  ensurePanel();

  document.getElementById('toc-panel')?.classList.remove('open');

  state.vocab.searchQuery = '';
  const searchInput = state.vocab.panelEl.querySelector('.vocab-search');
  if (searchInput) searchInput.value = '';

  // ── Book state from caller ──
  // bookId is passed explicitly by main.js, which KNOWS the book is loaded
  // because it called loadEpub(). No cross-module state query needed.
  const bookLoaded = bookId != null;
  const bookCb = state.vocab.panelEl.querySelector('.vocab-book-cb');
  const statusEl = state.vocab.panelEl.querySelector('.vocab-scan-status');

  // If the book changed (or was closed), invalidate the cached scan
  if (bookId !== state.vocab.lastBookId) {
    state.vocab.bookWordSet = null;
    state.vocab.bookScanInProgress = false;
    state.vocab.inBookOnly = false;
    state.vocab.lastBookId = bookId;
  }

  // Enable/disable mark-page button based on whether we have an iframe
  const markPageBtn = state.vocab.panelEl.querySelector('.vocab-mark-page-btn');
  if (markPageBtn) markPageBtn.disabled = !bookLoaded;

  // Sync the checkbox and status with current book state
  if (!bookLoaded) {
    state.vocab.inBookOnly = false;
    bookCb.checked = false;
    bookCb.disabled = true;
    statusEl.textContent = 'No book open';
  } else {
    bookCb.disabled = false;
    // Auto-enable book mode when a book is loaded — the user opened the
    // vocab panel from within a book, so "words in this book" is the
    // natural expectation. They can uncheck to see DB-only if they want.
    state.vocab.inBookOnly = true;
    bookCb.checked = true;
    if (state.vocab.bookWordSet) {
      statusEl.textContent = `${state.vocab.bookWordSet.size} unique`;
    } else {
      statusEl.textContent = '';
    }
  }

  // Load saved words from DB
  try {
    state.vocab.dbWords = await getAllWords(state.currentLanguage);
  } catch (err) {
    console.error('[vocab] getAllWords failed:', err);
    state.vocab.dbWords = [];
  }

  // If book mode is active but we haven't scanned yet, scan now
  if (state.vocab.inBookOnly && !state.vocab.bookWordSet && !state.vocab.bookScanInProgress) {
    try {
      await scanBook();
    } catch (err) {
      console.error('[vocab] scanBook failed:', err);
    }
  }

  // Update forget button AFTER scan (state.vocab.bookWordSet is now set)
  updateForgetBookBtn();

  await rebuildDisplayWords();

  state.vocab.panelEl.classList.add('open');
  renderList();
}

/**
 * Build the state.vocab.displayWords array based on current mode.
 *
 * DB-only mode (state.vocab.inBookOnly=false): state.vocab.displayWords = state.vocab.dbWords (level 1 + 2 only).
 * In-book mode with successful scan: state.vocab.displayWords = every word in the book, with DB levels.
 * In-book mode with failed/empty scan: state.vocab.displayWords = [] (empty — NOT cross-book state.vocab.dbWords).
 */
async function rebuildDisplayWords() {
  if (state.vocab.inBookOnly && state.vocab.bookWordSet && state.vocab.bookWordSet.size > 0) {
    // Build a level map from DB words for fast lookup
    const levelMap = new Map();
    for (const w of state.vocab.dbWords) levelMap.set(w.word, w.level);

    // Show every book word with its DB level (default 0 = unknown)
    state.vocab.displayWords = [];
    for (const word of state.vocab.bookWordSet) {
      state.vocab.displayWords.push({ word, level: levelMap.get(word) || 0 });
    }
  } else if (state.vocab.inBookOnly) {
    // Scan failed or returned empty — show NOTHING rather than cross-book words.
    // The empty state message in renderList() tells the user to uncheck "In this book".
    state.vocab.displayWords = [];
  } else {
    // DB-only mode (checkbox unchecked) — show all saved words for this language
    state.vocab.displayWords = [...state.vocab.dbWords];
  }
}

export function closePanel() {
  if (state.vocab.panelEl) state.vocab.panelEl.classList.remove('open');
}

export function isOpen() {
  return state.vocab.panelEl?.classList.contains('open') ?? false;
}

export async function togglePanel(language, options) {
  if (isOpen()) {
    closePanel();
  } else {
    if (state.vocab.openInProgress) return;
    state.vocab.openInProgress = true;
    try {
      await openPanel(language, options);
    } finally {
      state.vocab.openInProgress = false;
    }
  }
}

/**
 * Scan the full book spine for all words. Shows progress in the panel.
 */
async function scanBook() {
  state.vocab.bookScanInProgress = true;
  const statusEl = state.vocab.panelEl.querySelector('.vocab-scan-status');
  statusEl.textContent = 'Scanning\u2026';

  const result = await getAllBookWords((frac) => {
    statusEl.textContent = `${Math.round(frac * 100)}%`;
  });

  state.vocab.bookScanInProgress = false;

  if (result && result.size > 0) {
    state.vocab.bookWordSet = result;
    statusEl.textContent = `${state.vocab.bookWordSet.size} unique`;
  } else {
    // Scan failed or found no words — keep state.vocab.bookWordSet null so
    // rebuildDisplayWords falls back to DB words instead of showing empty.
    state.vocab.bookWordSet = null;
    statusEl.textContent = result === null ? '' : 'Scan found no words';
    console.warn('[vocab] scan returned', result === null ? 'null' : `empty (${result.size})`, '— falling back to saved words');
  }
}

/**
 * Build grouped data and render the list.
 */
function renderList() {
  const listEl = state.vocab.panelEl.querySelector('.vocab-list');
  const summaryEl = state.vocab.panelEl.querySelector('.vocab-summary');

  // 1. Filter by level
  let filtered = state.vocab.displayWords;
  if (state.vocab.activeFilter !== 'all') {
    filtered = filtered.filter(w => w.level === state.vocab.activeFilter);
  }

  // 2. Filter by search
  if (state.vocab.searchQuery) {
    filtered = filtered.filter(w => w.word.includes(state.vocab.searchQuery));
  }

  // 3. Empty state
  if (filtered.length === 0) {
    let msg;
    if (state.vocab.inBookOnly && (!state.vocab.bookWordSet || state.vocab.bookWordSet.size === 0)) {
      // Scan failed/empty while "In this book" is checked
      msg = 'Book scan could not complete.<br>Uncheck \u201CIn this book\u201D to see all saved words.';
    } else if (state.vocab.displayWords.length === 0) {
      msg = 'No vocabulary saved yet.<br>Tap words while reading to build your list.';
    } else if (state.vocab.activeFilter === 0 && !(state.vocab.bookWordSet && state.vocab.bookWordSet.size > 0)) {
      msg = 'Unknown words are only visible when the<br>book scan completes successfully.';
    } else {
      msg = 'No words match the current filters.';
    }
    listEl.innerHTML = `<div class="vb-empty">${msg}</div>`;
    summaryEl.textContent = '';
    return;
  }

  // 4. Group by stem
  const groups = new Map();
  for (const w of filtered) {
    const s = stem(w.word, state.currentLanguage);
    if (!groups.has(s)) groups.set(s, []);
    groups.get(s).push(w);
  }

  // 5. Sort: multi-word groups first (by size desc), then alphabetical
  const sorted = [...groups.entries()].sort((a, b) => {
    if (b[1].length !== a[1].length) return b[1].length - a[1].length;
    return a[0].localeCompare(b[0]);
  });

  // 6. Render
  const totalWords = sorted.reduce((sum, [, ws]) => sum + ws.length, 0);
  const multiGroups = sorted.filter(([, ws]) => ws.length > 1).length;

  let html = '';
  for (const [stemKey, words] of sorted) {
    words.sort((a, b) => a.word.localeCompare(b.word));
    const isSingle = words.length === 1;

    if (isSingle) {
      const w = words[0];
      html += `<div class="vb-word-row vb-flat-row" data-word="${escapeHtml(w.word)}">
        <span class="vb-word-text">${escapeHtml(w.word)}</span>
        <span class="vb-badge ${LEVEL_CLASSES[w.level]}">${LEVEL_SYMBOLS[w.level]}</span>
      </div>`;
    } else {
      html += `<div class="vb-group" data-stem="${escapeHtml(stemKey)}">
        <div class="vb-group-header">
          <span class="vb-group-chevron"></span>
          <span class="vb-group-stem">${escapeHtml(stemKey)}</span>
          <span class="vb-group-count">${words.length}</span>
          <span class="vb-group-actions">
            <button class="vb-group-mark vb-partial" data-level="${LEVEL_PARTIAL}" title="Mark group as learning">~</button>
            <button class="vb-group-mark vb-known" data-level="${LEVEL_KNOWN}" title="Mark group as known">\u2713</button>
          </span>
        </div>
        <div class="vb-group-body">`;
      for (const w of words) {
        html += `<div class="vb-word-row" data-word="${escapeHtml(w.word)}">
          <span class="vb-word-text">${escapeHtml(w.word)}</span>
          <span class="vb-badge ${LEVEL_CLASSES[w.level]}">${LEVEL_SYMBOLS[w.level]}</span>
        </div>`;
      }
      html += `</div></div>`;
    }
  }

  listEl.innerHTML = html;
  summaryEl.textContent = `${totalWords} word${totalWords !== 1 ? 's' : ''}${multiGroups > 0 ? ` \u00b7 ${multiGroups} group${multiGroups !== 1 ? 's' : ''}` : ''}`;
}

/**
 * Cycle a single word's level (same as tapping in-reader).
 */
async function cycleWord(word) {
  const entry = state.vocab.displayWords.find(w => w.word === word);
  if (!entry) return;

  const newLevel = (entry.level + 1) % 3;
  entry.level = newLevel;
  await setLevel(state.currentLanguage, word, newLevel);
  adjustDbEntry(word, newLevel);

  updateRowBadge(word, newLevel);
  syncReaderSpans(word, newLevel);
  if (state.vocab.onStatsUpdate) state.vocab.onStatsUpdate();
}

/**
 * Mark all words in a stem group to a target level (with undo).
 */
async function markGroup(stemKey, targetLevel) {
  const previousState = [];
  const updates = [];
  for (const entry of state.vocab.displayWords) {
    if (stem(entry.word, state.currentLanguage) === stemKey && entry.level !== targetLevel) {
      previousState.push({ word: entry.word, level: entry.level });
      entry.level = targetLevel;
      updates.push(setLevel(state.currentLanguage, entry.word, targetLevel));
      adjustDbEntry(entry.word, targetLevel);
      syncReaderSpans(entry.word, targetLevel);
    }
  }
  await Promise.all(updates);
  updateGroupRows(stemKey);
  if (state.vocab.onStatsUpdate) state.vocab.onStatsUpdate();

  if (previousState.length > 0) {
    showUndoToast(`Marked ${previousState.length} words`, async () => {
      const restoreUpdates = [];
      for (const { word, level } of previousState) {
        const entry = state.vocab.displayWords.find(e => e.word === word);
        if (entry) entry.level = level;
        restoreUpdates.push(setLevel(state.currentLanguage, word, level));
        adjustDbEntry(word, level);
        syncReaderSpans(word, level);
      }
      await Promise.all(restoreUpdates);
      updateGroupRows(stemKey);
      if (state.vocab.onStatsUpdate) state.vocab.onStatsUpdate();
    });
  }
}

function updateGroupRows(stemKey) {
  const groupEl = state.vocab.panelEl.querySelector(`.vb-group[data-stem="${CSS.escape(stemKey)}"]`);
  if (groupEl) {
    groupEl.querySelectorAll('.vb-word-row').forEach(row => {
      const w = row.dataset.word;
      const entry = state.vocab.displayWords.find(e => e.word === w);
      if (entry) {
        const badge = row.querySelector('.vb-badge');
        badge.className = `vb-badge ${LEVEL_CLASSES[entry.level]}`;
        badge.textContent = LEVEL_SYMBOLS[entry.level];
      }
    });
  }
}

function updateRowBadge(word, level) {
  const row = state.vocab.panelEl.querySelector(`.vb-word-row[data-word="${CSS.escape(word)}"]`);
  if (!row) return;
  const badge = row.querySelector('.vb-badge');
  badge.className = `vb-badge ${LEVEL_CLASSES[level]}`;
  badge.textContent = LEVEL_SYMBOLS[level];
}

function updateForgetBookBtn() {
  const btn = state.vocab.panelEl?.querySelector('.vocab-forget-btn[data-scope="book"]');
  if (btn) btn.disabled = !(state.vocab.inBookOnly && state.vocab.bookWordSet && state.vocab.bookWordSet.size > 0);
}

// ── Forget operations ────────────────────────────────────────────────

/**
 * Forget all saved words for the current language.
 * Deletes from IndexedDB, resets panel state, updates reader.
 */
async function forgetAllWords() {
  const deleted = await deleteAllWords(state.currentLanguage);
  if (deleted.length === 0) return;

  state.vocab.dbWords = [];
  await rebuildDisplayWords();
  renderList();
  syncAllReaderSpans();
  if (state.vocab.onStatsUpdate) state.vocab.onStatsUpdate();

  showUndoToast(`Forgot ${deleted.length} words`, async () => {
    await importVocab(deleted);
    state.vocab.dbWords = deleted.map(e => ({ word: e.word, level: e.level }));
    await rebuildDisplayWords();
    renderList();
    syncAllReaderSpans();
    if (state.vocab.onStatsUpdate) state.vocab.onStatsUpdate();
  });
}

/**
 * Forget saved words that appear in the current book.
 * Only available when "In this book" is enabled and state.vocab.bookWordSet exists.
 */
async function forgetBookWords() {
  if (!state.vocab.bookWordSet) return;
  const bookWordsArray = [...state.vocab.bookWordSet];
  const deleted = await deleteWordsList(state.currentLanguage, bookWordsArray);
  if (deleted.length === 0) return;

  // Remove deleted words from state.vocab.dbWords
  const deletedSet = new Set(deleted.map(e => e.word));
  state.vocab.dbWords = state.vocab.dbWords.filter(w => !deletedSet.has(w.word));
  await rebuildDisplayWords();
  renderList();
  syncAllReaderSpans();
  if (state.vocab.onStatsUpdate) state.vocab.onStatsUpdate();

  showUndoToast(`Forgot ${deleted.length} words in book`, async () => {
    await importVocab(deleted);
    for (const e of deleted) state.vocab.dbWords.push({ word: e.word, level: e.level });
    await rebuildDisplayWords();
    renderList();
    syncAllReaderSpans();
    if (state.vocab.onStatsUpdate) state.vocab.onStatsUpdate();
  });
}

/**
 * Reset book-related state. Call when the current book is closed
 * so the next openPanel starts with a clean slate.
 */
export function resetBookState() {
  state.vocab.bookWordSet = null;
  state.vocab.bookScanInProgress = false;
  state.vocab.lastBookId = null;
  state.vocab.inBookOnly = false;
}

// ── Utilities ────────────────────────────────────────────────────────
