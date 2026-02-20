/**
 * Vocabulary Browser: a slide-in panel that shows all saved vocab
 * for the current language, with grouping by stem, filtering by
 * level and book presence, and group-level bulk marking.
 */
import { getAllWords, setLevel } from './vocab-store.js';
import { getAllBookWords, getIframeDocument } from './epub-reader.js';
import { stem } from './stemmer.js';
import { LEVEL_UNKNOWN, LEVEL_PARTIAL, LEVEL_KNOWN } from './highlighter.js';

const LEVEL_LABELS = ['unknown', 'learning', 'known'];
const LEVEL_CLASSES = ['vb-unknown', 'vb-partial', 'vb-known'];
const LEVEL_SYMBOLS = ['?', '~', '\u2713'];

let panelEl = null;
let currentLanguage = null;
let allWords = []; // [{word, level}]
let bookWords = null; // Set<string> | null
let bookScanInProgress = false;
let activeFilter = 'all'; // 'all' | 0 | 1 | 2
let inBookOnly = false;
let searchQuery = '';
let onStatsUpdate = null; // callback to refresh main stats bar

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
      <button class="toolbar-btn vocab-close-btn">\u2715</button>
    </div>
    <div class="vocab-filters">
      <input type="search" class="vocab-search input-full" placeholder="Search words\u2026" />
      <div class="vocab-level-btns">
        <button class="vocab-lvl-btn active" data-filter="all">All</button>
        <button class="vocab-lvl-btn vb-unknown" data-filter="0">?</button>
        <button class="vocab-lvl-btn vb-partial" data-filter="1">~</button>
        <button class="vocab-lvl-btn vb-known" data-filter="2">\u2713</button>
      </div>
      <label class="vocab-book-toggle">
        <input type="checkbox" class="vocab-book-cb" />
        <span>In this book</span>
        <span class="vocab-scan-status"></span>
      </label>
    </div>
    <div class="vocab-list"></div>
    <div class="vocab-summary"></div>
  `;

  // Close button
  panelEl.querySelector('.vocab-close-btn').addEventListener('click', closePanel);

  // Search
  const searchInput = panelEl.querySelector('.vocab-search');
  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value.toLowerCase().trim();
    renderList();
  });

  // Level filter buttons
  panelEl.querySelector('.vocab-level-btns').addEventListener('click', (e) => {
    const btn = e.target.closest('.vocab-lvl-btn');
    if (!btn) return;
    const f = btn.dataset.filter;
    activeFilter = f === 'all' ? 'all' : parseInt(f, 10);
    panelEl.querySelectorAll('.vocab-lvl-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderList();
  });

  // In-book toggle
  const bookCb = panelEl.querySelector('.vocab-book-cb');
  bookCb.addEventListener('change', async () => {
    inBookOnly = bookCb.checked;
    if (inBookOnly && !bookWords && !bookScanInProgress) {
      await scanBook();
    }
    renderList();
  });

  // Delegated click on the word list
  panelEl.querySelector('.vocab-list').addEventListener('click', (e) => {
    // Group header toggle
    const header = e.target.closest('.vb-group-header');
    if (header) {
      const group = header.closest('.vb-group');
      group.classList.toggle('collapsed');
      return;
    }

    // Group-level "mark all" buttons
    const markBtn = e.target.closest('.vb-group-mark');
    if (markBtn) {
      const level = parseInt(markBtn.dataset.level, 10);
      const group = markBtn.closest('.vb-group');
      const stemKey = group.dataset.stem;
      markGroup(stemKey, level);
      return;
    }

    // Individual word tap → cycle level
    const row = e.target.closest('.vb-word-row');
    if (row) {
      cycleWord(row.dataset.word);
    }
  });

  document.querySelector('.main-area').appendChild(panelEl);
  return panelEl;
}

/**
 * Open the vocab browser panel.
 */
export async function openPanel(language, statsCallback) {
  currentLanguage = language;
  onStatsUpdate = statsCallback || null;
  ensurePanel();

  // Close TOC if open
  document.getElementById('toc-panel')?.classList.remove('open');

  // Reset filters
  searchQuery = '';
  const searchInput = panelEl.querySelector('.vocab-search');
  if (searchInput) searchInput.value = '';

  // Load words from DB
  allWords = await getAllWords(currentLanguage);

  panelEl.classList.add('open');
  renderList();
}

/**
 * Close the vocab browser panel.
 */
export function closePanel() {
  if (panelEl) panelEl.classList.remove('open');
}

export function isOpen() {
  return panelEl?.classList.contains('open') ?? false;
}

/**
 * Toggle the panel.
 */
export function togglePanel(language, statsCallback) {
  if (isOpen()) {
    closePanel();
  } else {
    openPanel(language, statsCallback);
  }
}

/**
 * Scan the full book spine for all words. Shows progress in the panel.
 */
async function scanBook() {
  bookScanInProgress = true;
  const statusEl = panelEl.querySelector('.vocab-scan-status');
  statusEl.textContent = 'Scanning\u2026';

  bookWords = await getAllBookWords((frac) => {
    statusEl.textContent = `${Math.round(frac * 100)}%`;
  });

  bookScanInProgress = false;
  statusEl.textContent = bookWords ? `${bookWords.size} unique` : '';
  renderList();
}

/**
 * Build grouped data and render the list.
 */
function renderList() {
  const listEl = panelEl.querySelector('.vocab-list');
  const summaryEl = panelEl.querySelector('.vocab-summary');

  // 1. Filter
  let filtered = allWords;
  if (activeFilter !== 'all') {
    filtered = filtered.filter(w => w.level === activeFilter);
  }
  if (inBookOnly && bookWords) {
    filtered = filtered.filter(w => bookWords.has(w.word));
  }
  if (searchQuery) {
    filtered = filtered.filter(w => w.word.includes(searchQuery));
  }

  // 2. Group by stem
  const groups = new Map();
  for (const w of filtered) {
    const s = stem(w.word, currentLanguage);
    if (!groups.has(s)) groups.set(s, []);
    groups.get(s).push(w);
  }

  // 3. Sort: multi-word groups first (by size desc), then alphabetical within
  const sorted = [...groups.entries()].sort((a, b) => {
    if (b[1].length !== a[1].length) return b[1].length - a[1].length;
    return a[0].localeCompare(b[0]);
  });

  // 4. Render
  if (sorted.length === 0) {
    listEl.innerHTML = `<div class="vb-empty">${
      allWords.length === 0
        ? 'No vocabulary saved yet.<br>Tap words while reading to build your list.'
        : 'No words match the current filters.'
    }</div>`;
    summaryEl.textContent = '';
    return;
  }

  const totalWords = sorted.reduce((sum, [, ws]) => sum + ws.length, 0);
  const multiGroups = sorted.filter(([, ws]) => ws.length > 1).length;

  let html = '';
  for (const [stemKey, words] of sorted) {
    // Sort words within group alphabetically
    words.sort((a, b) => a.word.localeCompare(b.word));

    const isSingle = words.length === 1;

    if (isSingle) {
      // Flat row — no group header
      const w = words[0];
      html += `<div class="vb-word-row vb-flat-row" data-word="${esc(w.word)}">
        <span class="vb-word-text">${esc(w.word)}</span>
        <span class="vb-badge ${LEVEL_CLASSES[w.level]}">${LEVEL_SYMBOLS[w.level]}</span>
      </div>`;
    } else {
      // Group with header + mark-all buttons
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
  const entry = allWords.find(w => w.word === word);
  if (!entry) return;

  const newLevel = (entry.level + 1) % 3;
  entry.level = newLevel;
  await setLevel(currentLanguage, word, newLevel);

  // Update the row in the panel
  updateRowBadge(word, newLevel);

  // Update matching spans in the reader iframe
  syncReaderSpans(word, newLevel);

  if (onStatsUpdate) onStatsUpdate();
}

/**
 * Mark all words in a stem group to a target level.
 */
async function markGroup(stemKey, targetLevel) {
  const updates = [];
  for (const entry of allWords) {
    if (stem(entry.word, currentLanguage) === stemKey && entry.level !== targetLevel) {
      entry.level = targetLevel;
      updates.push(setLevel(currentLanguage, entry.word, targetLevel));
      syncReaderSpans(entry.word, targetLevel);
    }
  }
  await Promise.all(updates);

  // Re-render group rows
  const groupEl = panelEl.querySelector(`.vb-group[data-stem="${CSS.escape(stemKey)}"]`);
  if (groupEl) {
    groupEl.querySelectorAll('.vb-word-row').forEach(row => {
      const w = row.dataset.word;
      const entry = allWords.find(e => e.word === w);
      if (entry) {
        const badge = row.querySelector('.vb-badge');
        badge.className = `vb-badge ${LEVEL_CLASSES[entry.level]}`;
        badge.textContent = LEVEL_SYMBOLS[entry.level];
      }
    });
  }

  if (onStatsUpdate) onStatsUpdate();
}

/**
 * Update a single word row's badge in the panel DOM.
 */
function updateRowBadge(word, level) {
  const row = panelEl.querySelector(`.vb-word-row[data-word="${CSS.escape(word)}"]`);
  if (!row) return;
  const badge = row.querySelector('.vb-badge');
  badge.className = `vb-badge ${LEVEL_CLASSES[level]}`;
  badge.textContent = LEVEL_SYMBOLS[level];
}

/**
 * Sync a word's visual state in the reader iframe.
 */
function syncReaderSpans(word, level) {
  const iframeDoc = getIframeDocument();
  if (!iframeDoc) return;
  const HL_CLASSES = ['hl-unknown', 'hl-partial', 'hl-known'];
  iframeDoc.querySelectorAll(`.hl-word[data-word="${CSS.escape(word)}"][data-language="${CSS.escape(currentLanguage)}"]`)
    .forEach(el => {
      el.dataset.level = level;
      el.className = `hl-word ${HL_CLASSES[level]}`;
    });
}

function esc(str) {
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}
