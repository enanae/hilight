/**
 * Vocabulary Browser: a slide-in panel that shows all saved vocab
 * for the current language, with grouping by stem, filtering by
 * level and book presence, and group-level bulk marking.
 *
 * ── UX State Machine ───────────────────────────────────────────
 *
 * The panel has four main states, determined by two booleans:
 *
 *   isBookLoaded()  ×  inBookOnly
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
 *     (bookWordSet                spine and shows ALL book words with
 *      is non-null)               their DB levels (default 0 = unknown).
 *                                 All filters including "?" work.
 *
 *   true  × true    BOOK_SCANNING Transient: scan in progress.
 *     (bookWordSet                Shows "Scanning…" / percentage.
 *      is null)                   Falls back to DB-only display until
 *                                 scan completes.
 *
 * ── State Lifecycle ────────────────────────────────────────────
 *
 * openPanel():
 *   ALWAYS resets:  searchQuery
 *   RESETS on book change (bookId !== lastBookId):
 *     bookWordSet, bookScanInProgress, inBookOnly
 *   AUTO-ENABLES when book loaded:
 *     inBookOnly = true, triggers scan if bookWordSet is null.
 *     User sees book words immediately without manual checkbox toggle.
 *   PRESERVES across re-opens of same book:
 *     bookWordSet (scan cache), activeFilter
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
 * DB-only mode: displayWords = dbWords (level 1+2 only from IndexedDB).
 *   Level 0 words are not stored in the DB.
 * "In this book" mode: scans the full epub spine and builds a word list
 *   from the BOOK, then looks up each word's level from the DB (default 0).
 */
import { getAllWords, setLevel, deleteAllWords, deleteWordsList, importVocab } from './vocab-store.js';
import { getAllBookWords } from './epub-reader.js';
import { stem } from './stemmer.js';
import { LEVEL_PARTIAL, LEVEL_KNOWN } from './highlighter.js';

const LEVEL_CLASSES = ['vb-unknown', 'vb-partial', 'vb-known'];
const LEVEL_SYMBOLS = ['?', '~', '\u2713'];

let panelEl = null;
let currentLanguage = null;
let displayWords = []; // [{word, level}] — the current working set
let dbWords = [];      // [{word, level}] — from IndexedDB (level 1+2 only)
let bookWordSet = null; // Set<string> | null — all normalized words in the book
let bookScanInProgress = false;
let activeFilter = 'all'; // 'all' | 0 | 1 | 2
let inBookOnly = false;
let lastBookId = null;
let searchQuery = '';
let onStatsUpdate = null;
let iframeDocGetter = null; // () => Document|null — injected by caller

// ── Helpers ──────────────────────────────────────────────────────────

const HL_CLASSES = ['hl-unknown', 'hl-partial', 'hl-known'];

/**
 * Keep dbWords array in sync after a word level change.
 * dbWords only holds level 1+2 entries (level 0 = not stored).
 */
function adjustDbEntry(word, level) {
  const idx = dbWords.findIndex(w => w.word === word);
  if (idx !== -1) {
    if (level === 0) {
      dbWords.splice(idx, 1);
    } else {
      dbWords[idx].level = level;
    }
  } else if (level !== 0) {
    dbWords.push({ word, level });
  }
}

/** Update a single word's spans in the reader iframe. */
function syncReaderSpans(word, level) {
  const iframeDoc = iframeDocGetter ? iframeDocGetter() : null;
  if (!iframeDoc) return;
  iframeDoc.querySelectorAll(`.hl-word[data-word="${CSS.escape(word)}"][data-language="${CSS.escape(currentLanguage)}"]`)
    .forEach(el => {
      el.dataset.level = level;
      el.className = `hl-word ${HL_CLASSES[level]}`;
    });
}

/** Bulk-update all reader spans to reflect current dbWords state. */
function syncAllReaderSpans() {
  const iframeDoc = iframeDocGetter ? iframeDocGetter() : null;
  if (!iframeDoc) return;
  const levelMap = new Map();
  for (const w of dbWords) levelMap.set(w.word, w.level);
  iframeDoc.querySelectorAll(`.hl-word[data-language="${CSS.escape(currentLanguage)}"]`)
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
  if (panelEl) return panelEl;

  panelEl = document.createElement('div');
  panelEl.id = 'vocab-panel';
  panelEl.className = 'vocab-panel';
  panelEl.innerHTML = `
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
      <button class="vocab-forget-btn" data-scope="book" disabled title="Forget saved words that appear in the current book">Forget in book</button>
      <button class="vocab-forget-btn" data-scope="all" title="Forget all saved words for this language">Forget all</button>
    </div>
  `;

  panelEl.querySelector('.vocab-close-btn').addEventListener('click', closePanel);

  const searchInput = panelEl.querySelector('.vocab-search');
  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value.toLowerCase().trim();
    renderList();
  });

  panelEl.querySelector('.vocab-level-btns').addEventListener('click', (e) => {
    const btn = e.target.closest('.vocab-lvl-btn');
    if (!btn) return;
    const f = btn.dataset.filter;
    activeFilter = f === 'all' ? 'all' : parseInt(f, 10);
    panelEl.querySelectorAll('.vocab-lvl-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderList();
  });

  const bookCb = panelEl.querySelector('.vocab-book-cb');
  bookCb.addEventListener('change', async () => {
    inBookOnly = bookCb.checked;
    if (inBookOnly && !bookWordSet && !bookScanInProgress) {
      await scanBook();
    }
    updateForgetBookBtn();
    await rebuildDisplayWords();
    renderList();
  });

  panelEl.querySelector('.vocab-list').addEventListener('click', (e) => {
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

  panelEl.querySelector('.vocab-actions').addEventListener('click', (e) => {
    const btn = e.target.closest('.vocab-forget-btn');
    if (!btn || btn.disabled) return;
    const scope = btn.dataset.scope;
    if (scope === 'all') forgetAllWords();
    if (scope === 'book') forgetBookWords();
  });

  document.querySelector('.main-area').appendChild(panelEl);
  return panelEl;
}

/**
 * Open the vocab browser panel.
 *
 * UX state on open:
 * - Search is cleared.
 * - Book toggle is enabled/disabled based on whether a book is loaded.
 * - If the book changed since last open, cached bookWordSet is invalidated
 *   and inBookOnly resets to false so the user starts fresh.
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
  currentLanguage = language;
  onStatsUpdate = statsCallback || null;
  iframeDocGetter = getIframeDocFn || null;
  ensurePanel();

  document.getElementById('toc-panel')?.classList.remove('open');

  searchQuery = '';
  const searchInput = panelEl.querySelector('.vocab-search');
  if (searchInput) searchInput.value = '';

  // ── Book state from caller ──
  // bookId is passed explicitly by main.js, which KNOWS the book is loaded
  // because it called loadEpub(). No cross-module state query needed.
  const bookLoaded = bookId != null;
  const bookCb = panelEl.querySelector('.vocab-book-cb');
  const statusEl = panelEl.querySelector('.vocab-scan-status');

  // If the book changed (or was closed), invalidate the cached scan
  if (bookId !== lastBookId) {
    bookWordSet = null;
    bookScanInProgress = false;
    inBookOnly = false;
    lastBookId = bookId;
  }

  // Sync the checkbox and status with current book state
  if (!bookLoaded) {
    inBookOnly = false;
    bookCb.checked = false;
    bookCb.disabled = true;
    statusEl.textContent = 'No book open';
  } else {
    bookCb.disabled = false;
    // Auto-enable book mode when a book is loaded — the user opened the
    // vocab panel from within a book, so "words in this book" is the
    // natural expectation. They can uncheck to see DB-only if they want.
    inBookOnly = true;
    bookCb.checked = true;
    if (bookWordSet) {
      statusEl.textContent = `${bookWordSet.size} unique`;
    } else {
      statusEl.textContent = '';
    }
  }

  // Load saved words from DB
  dbWords = await getAllWords(currentLanguage);

  // If book mode is active but we haven't scanned yet, scan now
  if (inBookOnly && !bookWordSet && !bookScanInProgress) {
    await scanBook();
  }

  // Update forget button AFTER scan (bookWordSet is now set)
  updateForgetBookBtn();

  await rebuildDisplayWords();

  panelEl.classList.add('open');
  renderList();
}

/**
 * Build the displayWords array based on current mode.
 *
 * DB-only mode: displayWords = dbWords (level 1 + 2 only).
 * In-book mode: displayWords = every word in the book, with DB levels.
 */
async function rebuildDisplayWords() {
  if (inBookOnly && bookWordSet) {
    // Build a level map from DB words for fast lookup
    const levelMap = new Map();
    for (const w of dbWords) levelMap.set(w.word, w.level);

    // Also bulk-lookup any book words not in dbWords (they'll be level 0)
    // dbWords only has level 1+2, so all level 0 words need no lookup — they default to 0
    displayWords = [];
    for (const word of bookWordSet) {
      displayWords.push({ word, level: levelMap.get(word) || 0 });
    }
  } else {
    displayWords = [...dbWords];
  }
}

export function closePanel() {
  if (panelEl) panelEl.classList.remove('open');
}

export function isOpen() {
  return panelEl?.classList.contains('open') ?? false;
}

export function togglePanel(language, options) {
  if (isOpen()) {
    closePanel();
  } else {
    openPanel(language, options);
  }
}

/**
 * Scan the full book spine for all words. Shows progress in the panel.
 */
async function scanBook() {
  bookScanInProgress = true;
  const statusEl = panelEl.querySelector('.vocab-scan-status');
  statusEl.textContent = 'Scanning\u2026';

  bookWordSet = await getAllBookWords((frac) => {
    statusEl.textContent = `${Math.round(frac * 100)}%`;
  });

  bookScanInProgress = false;
  statusEl.textContent = bookWordSet ? `${bookWordSet.size} unique` : '';
}

/**
 * Build grouped data and render the list.
 */
function renderList() {
  const listEl = panelEl.querySelector('.vocab-list');
  const summaryEl = panelEl.querySelector('.vocab-summary');

  // 1. Filter by level
  let filtered = displayWords;
  if (activeFilter !== 'all') {
    filtered = filtered.filter(w => w.level === activeFilter);
  }

  // 2. Filter by search
  if (searchQuery) {
    filtered = filtered.filter(w => w.word.includes(searchQuery));
  }

  // 3. Empty state
  if (filtered.length === 0) {
    let msg;
    if (displayWords.length === 0 && !inBookOnly) {
      msg = 'No vocabulary saved yet.<br>Tap words while reading to build your list.';
    } else if (displayWords.length === 0 && inBookOnly) {
      msg = 'No book is open, or the scan found no words.';
    } else if (activeFilter === 0 && !inBookOnly) {
      msg = 'Unknown words are only visible with<br><strong>"In this book"</strong> enabled.';
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
    const s = stem(w.word, currentLanguage);
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
      html += `<div class="vb-word-row vb-flat-row" data-word="${esc(w.word)}">
        <span class="vb-word-text">${esc(w.word)}</span>
        <span class="vb-badge ${LEVEL_CLASSES[w.level]}">${LEVEL_SYMBOLS[w.level]}</span>
      </div>`;
    } else {
      html += `<div class="vb-group" data-stem="${esc(stemKey)}">
        <div class="vb-group-header">
          <span class="vb-group-chevron"></span>
          <span class="vb-group-stem">${esc(stemKey)}</span>
          <span class="vb-group-count">${words.length}</span>
          <span class="vb-group-actions">
            <button class="vb-group-mark vb-partial" data-level="${LEVEL_PARTIAL}" title="Mark group as learning">~</button>
            <button class="vb-group-mark vb-known" data-level="${LEVEL_KNOWN}" title="Mark group as known">\u2713</button>
          </span>
        </div>
        <div class="vb-group-body">`;
      for (const w of words) {
        html += `<div class="vb-word-row" data-word="${esc(w.word)}">
          <span class="vb-word-text">${esc(w.word)}</span>
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
  const entry = displayWords.find(w => w.word === word);
  if (!entry) return;

  const newLevel = (entry.level + 1) % 3;
  entry.level = newLevel;
  await setLevel(currentLanguage, word, newLevel);
  adjustDbEntry(word, newLevel);

  updateRowBadge(word, newLevel);
  syncReaderSpans(word, newLevel);
  if (onStatsUpdate) onStatsUpdate();
}

/**
 * Mark all words in a stem group to a target level (with undo).
 */
async function markGroup(stemKey, targetLevel) {
  const previousState = [];
  const updates = [];
  for (const entry of displayWords) {
    if (stem(entry.word, currentLanguage) === stemKey && entry.level !== targetLevel) {
      previousState.push({ word: entry.word, level: entry.level });
      entry.level = targetLevel;
      updates.push(setLevel(currentLanguage, entry.word, targetLevel));
      adjustDbEntry(entry.word, targetLevel);
      syncReaderSpans(entry.word, targetLevel);
    }
  }
  await Promise.all(updates);
  updateGroupRows(stemKey);
  if (onStatsUpdate) onStatsUpdate();

  if (previousState.length > 0) {
    showUndoToast(`Marked ${previousState.length} words`, async () => {
      const restoreUpdates = [];
      for (const { word, level } of previousState) {
        const entry = displayWords.find(e => e.word === word);
        if (entry) entry.level = level;
        restoreUpdates.push(setLevel(currentLanguage, word, level));
        adjustDbEntry(word, level);
        syncReaderSpans(word, level);
      }
      await Promise.all(restoreUpdates);
      updateGroupRows(stemKey);
      if (onStatsUpdate) onStatsUpdate();
    });
  }
}

function updateGroupRows(stemKey) {
  const groupEl = panelEl.querySelector(`.vb-group[data-stem="${CSS.escape(stemKey)}"]`);
  if (groupEl) {
    groupEl.querySelectorAll('.vb-word-row').forEach(row => {
      const w = row.dataset.word;
      const entry = displayWords.find(e => e.word === w);
      if (entry) {
        const badge = row.querySelector('.vb-badge');
        badge.className = `vb-badge ${LEVEL_CLASSES[entry.level]}`;
        badge.textContent = LEVEL_SYMBOLS[entry.level];
      }
    });
  }
}

function showUndoToast(message, onUndo) {
  const existing = document.querySelector('.undo-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'undo-toast';
  toast.innerHTML = `<span>${message}</span><button class="undo-btn">Undo</button>`;
  const btn = toast.querySelector('.undo-btn');
  let dismissed = false;
  btn.addEventListener('click', () => {
    if (dismissed) return;
    dismissed = true;
    toast.remove();
    onUndo();
  });
  document.getElementById('app').appendChild(toast);
  setTimeout(() => {
    dismissed = true;
    toast.remove();
  }, 6000);
}

function updateRowBadge(word, level) {
  const row = panelEl.querySelector(`.vb-word-row[data-word="${CSS.escape(word)}"]`);
  if (!row) return;
  const badge = row.querySelector('.vb-badge');
  badge.className = `vb-badge ${LEVEL_CLASSES[level]}`;
  badge.textContent = LEVEL_SYMBOLS[level];
}

function updateForgetBookBtn() {
  const btn = panelEl?.querySelector('.vocab-forget-btn[data-scope="book"]');
  if (btn) btn.disabled = !(inBookOnly && bookWordSet);
}

// ── Forget operations ────────────────────────────────────────────────

/**
 * Forget all saved words for the current language.
 * Deletes from IndexedDB, resets panel state, updates reader.
 */
async function forgetAllWords() {
  const deleted = await deleteAllWords(currentLanguage);
  if (deleted.length === 0) return;

  dbWords = [];
  await rebuildDisplayWords();
  renderList();
  syncAllReaderSpans();
  if (onStatsUpdate) onStatsUpdate();

  showUndoToast(`Forgot ${deleted.length} words`, async () => {
    await importVocab(deleted);
    dbWords = deleted.map(e => ({ word: e.word, level: e.level }));
    await rebuildDisplayWords();
    renderList();
    syncAllReaderSpans();
    if (onStatsUpdate) onStatsUpdate();
  });
}

/**
 * Forget saved words that appear in the current book.
 * Only available when "In this book" is enabled and bookWordSet exists.
 */
async function forgetBookWords() {
  if (!bookWordSet) return;
  const bookWordsArray = [...bookWordSet];
  const deleted = await deleteWordsList(currentLanguage, bookWordsArray);
  if (deleted.length === 0) return;

  // Remove deleted words from dbWords
  const deletedSet = new Set(deleted.map(e => e.word));
  dbWords = dbWords.filter(w => !deletedSet.has(w.word));
  await rebuildDisplayWords();
  renderList();
  syncAllReaderSpans();
  if (onStatsUpdate) onStatsUpdate();

  showUndoToast(`Forgot ${deleted.length} words in book`, async () => {
    await importVocab(deleted);
    for (const e of deleted) dbWords.push({ word: e.word, level: e.level });
    await rebuildDisplayWords();
    renderList();
    syncAllReaderSpans();
    if (onStatsUpdate) onStatsUpdate();
  });
}

/**
 * Reset book-related state. Call when the current book is closed
 * so the next openPanel starts with a clean slate.
 */
export function resetBookState() {
  bookWordSet = null;
  bookScanInProgress = false;
  lastBookId = null;
  inBookOnly = false;
}

// ── Utilities ────────────────────────────────────────────────────────

function esc(str) {
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}
