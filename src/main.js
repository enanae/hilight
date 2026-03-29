import './style.css';
import { loadEpub, nextPage, prevPage, getToc, goToHref, getIframeDocument, destroyEpub, setLanguage } from './epub-reader.js';
import { getStats, exportVocab, importVocab } from './vocab-store.js';
import { saveDictSettings, loadDictSettings, hasDictionary, getActiveProviderId, getProviderChoices } from './dictionary.js';
import { isPopupActive, dismissPopup, markAllKnown, restoreWordLevels, setWordLevel, showWordDefinition } from './highlighter.js';
import { togglePanel as toggleVocabPanel, closePanel as closeVocabPanel, resetBookState as resetVocabBookState } from './vocab-browser.js';
import { state } from './app-state.js';
import { isReviewMode, enterReviewMode, exitReviewMode, focusNextWord, focusPrevWord, focusWordAbove, focusWordBelow, getFocusedWord, toggleFilter, isShowingAll } from './review-mode.js';
import { escapeHtml, showUndoToast, showError } from './ui-utils.js';

const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'ko', name: 'Korean' },
  { code: 'ja', name: 'Japanese' },
  { code: 'zh', name: 'Chinese' },
  { code: 'ar', name: 'Arabic' },
  { code: 'ru', name: 'Russian' },
  { code: 'hi', name: 'Hindi' },
  { code: 'th', name: 'Thai' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'tr', name: 'Turkish' },
  { code: 'pl', name: 'Polish' },
  { code: 'nl', name: 'Dutch' },
  { code: 'sv', name: 'Swedish' },
];

// State is centralized in app-state.js — state.currentLanguage, state.defLanguage, state.currentBookId

/** Initialize the app. */
async function init() {
  renderApp();
  bindEvents();
  await updateStats();
}

function renderApp() {
  document.querySelector('#app').innerHTML = `
    <header class="app-header">
      <div class="header-left">
        <h1 class="logo">hilight<span class="version">v1.1.0</span></h1>
        <span class="tagline">free epub vocabulary builder</span>
      </div>
      <div class="header-right">
        <label class="header-label" for="lang-select">Book:
          <select id="lang-select" aria-label="Book language">
            ${LANGUAGES.map(l =>
              `<option value="${l.code}" ${l.code === state.currentLanguage ? 'selected' : ''}>${l.name}</option>`
            ).join('')}
          </select>
        </label>
        <label class="header-label" for="def-lang-select">Defs:
          <select id="def-lang-select" aria-label="Definition language">
            ${LANGUAGES.map(l =>
              `<option value="${l.code}" ${l.code === state.defLanguage ? 'selected' : ''}>${l.name}</option>`
            ).join('')}
          </select>
        </label>
        <button id="btn-settings" class="icon-btn" title="Dictionary settings" aria-label="Dictionary settings">&#9881;</button>
        <button id="btn-export" class="icon-btn" title="Export vocabulary as JSON" aria-label="Export vocabulary">&#128190;</button>
        <button id="btn-import" class="icon-btn" title="Import vocabulary from JSON" aria-label="Import vocabulary">&#128194;</button>
      </div>
    </header>

    <div class="stats-bar hidden" id="stats-bar">
      <span id="stat-unknown" class="stat stat-unknown" title="Unknown words on this page">? 0 <span class="stat-label">unknown</span></span>
      <span id="stat-partial" class="stat stat-partial" title="Learning words on this page">~ 0 <span class="stat-label">learning</span></span>
      <span id="stat-known" class="stat stat-known" title="Known words on this page">&#10003; 0 <span class="stat-label">known</span></span>
      <span id="stat-saved" class="stat stat-saved" title="Total words saved across all pages">&#128218; 0 saved</span>
    </div>

    <main class="main-area">
      <div id="upload-area" class="upload-area">
        <div class="upload-content">
          <div class="upload-icon">&#128214;</div>
          <h2>Open an epub file</h2>
          <p>tap to browse or drop a file</p>
          <input type="file" id="file-input" accept=".epub,application/epub+zip,application/octet-stream" hidden />
          <div class="upload-hint">
            <p>Every word starts highlighted. <strong>Tap</strong> a word to cycle:</p>
            <span class="demo-word demo-unknown">unknown</span>
            &#8594;
            <span class="demo-word demo-partial">learning</span>
            &#8594;
            <span class="demo-word demo-known">known</span>
            &#8594; ...
            <p class="hint-secondary"><strong>Long-press</strong> or <strong>double-tap</strong> any word for a dictionary definition.</p>
          </div>
          <p class="upload-gutenberg">Need an epub? Browse free books at <a href="https://www.gutenberg.org/browse/languages/" target="_blank" rel="noopener">Project Gutenberg</a></p>
        </div>
      </div>

      <div id="reader-area" class="reader-area">
        <div id="focus-bar" class="focus-bar">
          <button id="btn-exit-focus" class="toolbar-btn" title="Show menus (F)">&#8592;<span class="btn-label">Back</span></button>
          <button id="btn-focus-vocab" class="toolbar-btn" title="Vocabulary (V)">&#128218;<span class="btn-label">Vocab</span></button>
          <button id="btn-focus-help" class="toolbar-btn" title="Help (?)">?<span class="btn-label">Help</span></button>
        </div>
        <div class="reader-toolbar">
          <button id="btn-toc" class="toolbar-btn" title="Table of contents (T)">&#9776;<span class="btn-label">Contents</span></button>
          <span id="book-title" class="book-title"></span>
          <button id="btn-vocab" class="toolbar-btn" title="Browse and manage your vocabulary list (V)">&#128218;<span class="btn-label">Vocab</span></button>
          <button id="btn-help" class="toolbar-btn" title="Help (?)">?<span class="btn-label">Help</span></button>
          <button id="btn-open-book" class="toolbar-btn" title="Open a different book">&#128214;<span class="btn-label">Open</span></button>
          <button id="btn-focus" class="toolbar-btn" title="Focus mode — hide menus (F)">&#9673;<span class="btn-label">Focus</span></button>
          <button id="btn-close-book" class="toolbar-btn btn-close-book" title="Close this book and return to upload screen (W)">&#8617;<span class="btn-label">Close book</span></button>
        </div>
        <div id="epub-viewer" class="epub-viewer"></div>
        <div id="review-bar" class="review-bar">
          <span class="review-bar-label">REVIEW</span>
          <span class="review-bar-keys"><kbd>n</kbd>/<kbd>N</kbd> navigate</span>
          <span class="review-bar-keys"><kbd>1</kbd>/<kbd>2</kbd>/<kbd>3</kbd> grade</span>
          <span class="review-bar-keys"><kbd>d</kbd> define</span>
          <span class="review-bar-keys"><kbd>Space</kbd> next</span>
          <span id="review-bar-filter" class="review-bar-keys"><kbd>a</kbd> all</span>
          <span class="review-bar-keys"><kbd>Esc</kbd> exit</span>
        </div>
        <div id="reading-hint" class="reading-hint">
          <kbd>Tab</kbd> review words &middot; <kbd>f</kbd> focus &middot; <kbd>?</kbd> shortcuts
        </div>
      </div>

      <div id="toc-panel" class="toc-panel">
        <div class="toc-header">
          <strong>Table of Contents</strong>
          <button id="btn-close-toc" class="toolbar-btn">&#10005;</button>
        </div>
        <ul id="toc-list" class="toc-list"></ul>
      </div>
    </main>

    <!-- Settings modal -->
    <div id="settings-modal" class="modal">
      <div class="modal-backdrop"></div>
      <div class="modal-content">
        <div class="modal-header">
          <h2>Dictionary Settings</h2>
          <button id="btn-close-settings" class="toolbar-btn">&#10005;</button>
        </div>
        <div class="modal-body">
          <p>Dictionary for <strong id="settings-lang-name"></strong>:</p>
          <label>
            Provider:
            <select id="dict-provider" class="input-full">
              ${getProviderChoices().map(p =>
                `<option value="${p.id}">${p.name} &mdash; ${p.description}</option>`
              ).join('')}
              <option value="custom">Custom URL</option>
            </select>
          </label>
          <div id="custom-url-fields" class="custom-url-fields" style="display:none">
            <label>
              API URL template:
              <input type="text" id="dict-url" class="input-full"
                placeholder="https://api.example.com/{lang}/{word}" />
            </label>
            <p class="hint">Use <code>{word}</code> for the word and <code>{lang}</code> for the language code.</p>
          </div>
          <div class="modal-actions">
            <button id="btn-save-dict" class="btn-primary">Save</button>
            <button id="btn-reset-dict" class="btn-secondary">Reset to default</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Help modal -->
    <div id="help-modal" class="modal">
      <div class="modal-backdrop"></div>
      <div class="modal-content help-content">
        <div class="modal-header">
          <h2>Help</h2>
          <button id="btn-close-help" class="toolbar-btn">&#10005;</button>
        </div>
        <div class="modal-body">
          <div class="help-touch">
            <h3>How to use</h3>
            <dl class="help-keys">
              <dt>Tap a word</dt><dd>Cycle: unknown &#8594; learning &#8594; known</dd>
              <dt>Long-press</dt><dd>Show dictionary definition</dd>
              <dt>Double-tap</dt><dd>Show dictionary definition</dd>
              <dt>Scroll</dt><dd>Read through the chapter</dd>
            </dl>
            <h3>Toolbar</h3>
            <dl class="help-keys">
              <dt>&#9776; Contents</dt><dd>Open table of contents</dd>
              <dt>&#128218; Vocab</dt><dd>Browse and manage vocabulary (includes mark page as known)</dd>
              <dt>&#9673; Focus</dt><dd>Hide menus for distraction-free reading</dd>
              <dt>&#8617; Close book</dt><dd>Close the current book</dd>
            </dl>
          </div>
          <div class="help-keyboard">
            <div class="help-columns">
              <div class="help-section">
                <h3>Reading</h3>
                <dl class="help-keys">
                  <dt>&#8592; &#8594;</dt><dd>Previous / next page</dd>
                  <dt>Space</dt><dd>Next page</dd>
                  <dt>Shift+Space</dt><dd>Previous page</dd>
                  <dt>Tab / Enter</dt><dd>Enter review mode</dd>
                </dl>
              </div>
              <div class="help-section">
                <h3>Review Mode</h3>
                <dl class="help-keys">
                  <dt>n / N</dt><dd>Next / previous word</dd>
                  <dt>1 / 2 / 3</dt><dd>Unknown / partial / known</dd>
                  <dt>d / Enter</dt><dd>Show definition</dd>
                  <dt>Space</dt><dd>Apply last grade + next</dd>
                  <dt>a</dt><dd>Toggle all / unlearned</dd>
                  <dt>Esc</dt><dd>Exit review mode</dd>
                </dl>
              </div>
              <div class="help-section">
                <h3>General</h3>
                <dl class="help-keys">
                  <dt>T</dt><dd>Table of contents</dd>
                  <dt>K</dt><dd>Mark page as known</dd>
                  <dt>V</dt><dd>Vocabulary panel</dd>
                  <dt>F</dt><dd>Focus mode</dd>
                  <dt>W</dt><dd>Close book</dd>
                  <dt>?</dt><dd>This help</dd>
                </dl>
              </div>
            </div>
          </div>
          <p class="help-hint">Click a word to cycle its level. Long-press or double-tap for definition.</p>
        </div>
      </div>
    </div>

    <input type="file" id="import-input" accept=".json" hidden />
  `;
}

function bindEvents() {
  const uploadArea = document.getElementById('upload-area');
  const fileInput = document.getElementById('file-input');

  // File upload — stop propagation so the input click doesn't re-trigger the area click
  fileInput.addEventListener('click', (e) => e.stopPropagation());
  uploadArea.addEventListener('click', (e) => {
    // Don't open file picker when clicking links
    if (e.target.closest('a')) return;
    fileInput.click();
  });
  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('drag-over');
  });
  uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('drag-over');
  });
  uploadArea.addEventListener('drop', safeHandler(async (e) => {
    e.preventDefault();
    uploadArea.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.epub')) await openBook(file);
  }));
  fileInput.addEventListener('change', safeHandler(async () => {
    const file = fileInput.files[0];
    if (file && file.name.endsWith('.epub')) await openBook(file);
    fileInput.value = '';
  }));

  // Book language — re-highlights the current section with the new language
  document.getElementById('lang-select').addEventListener('change', safeHandler(async (e) => {
    state.currentLanguage = e.target.value;
    localStorage.setItem('hilight-lang', state.currentLanguage);
    await setLanguage(state.currentLanguage);
    await updateStats();
  }));

  // Definition language — controls which language definitions are fetched in
  document.getElementById('def-lang-select').addEventListener('change', (e) => {
    state.defLanguage = e.target.value;
    localStorage.setItem('hilight-def-lang', state.defLanguage);
  });

  // Keyboard shortcuts — dismiss popup on any key, then continue
  document.addEventListener('keydown', safeHandler(async (e) => {
    if (isPopupActive()) {
      dismissPopup(getIframeDocument());
      return;
    }
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

    // --- Modal open? Only Escape should work ---
    if (document.getElementById('help-modal').classList.contains('open')) {
      if (e.key === 'Escape' || e.key === '?') closeHelp();
      return;
    }
    if (document.getElementById('settings-modal').classList.contains('open')) {
      if (e.key === 'Escape') closeSettings();
      return;
    }

    // --- Review mode active ---
    if (isReviewMode()) {
      const iframeDoc = getIframeDocument();
      switch (e.key) {
        case 'n': {
          const result = focusNextWord(iframeDoc);
          if (result === 'end') {
            state.reviewPendingResume = true;
            state.reviewResumeDirection = 'forward';
            await nextPage();
          }
          break;
        }
        case 'N': {
          const result = focusPrevWord(iframeDoc);
          if (result === 'start') {
            state.reviewPendingResume = true;
            state.reviewResumeDirection = 'backward';
            await prevPage();
          }
          break;
        }
        case 'Tab':
          e.preventDefault();
          if (e.shiftKey) {
            const result = focusPrevWord(iframeDoc);
            if (result === 'start') { state.reviewPendingResume = true; state.reviewResumeDirection = 'backward'; await prevPage(); }
          } else {
            const result = focusNextWord(iframeDoc);
            if (result === 'end') { state.reviewPendingResume = true; state.reviewResumeDirection = 'forward'; await nextPage(); }
          }
          break;
        case '1': await gradeAndUpdate(0); break;
        case '2': await gradeAndUpdate(1); break;
        case '3': await gradeAndUpdate(2); break;
        case 'd':
        case 'Enter':
          showDefForFocused();
          break;
        case ' ':
          e.preventDefault();
          await quickAdvance();
          break;
        case 'a':
          toggleFilter(iframeDoc);
          updateReviewBarFilter();
          break;
        case 'Escape':
          e.preventDefault();
          dismissPopup(iframeDoc);
          exitReviewMode();
          hideReviewBar();
          break;
        case 'ArrowRight': {
          e.preventDefault();
          const result = focusNextWord(iframeDoc);
          if (result === 'end') {
            state.reviewPendingResume = true;
            state.reviewResumeDirection = 'forward';
            await nextPage();
          }
          break;
        }
        case 'ArrowLeft': {
          e.preventDefault();
          const result = focusPrevWord(iframeDoc);
          if (result === 'start') {
            state.reviewPendingResume = true;
            state.reviewResumeDirection = 'backward';
            await prevPage();
          }
          break;
        }
        case 'ArrowDown': {
          e.preventDefault();
          const result = focusWordBelow(iframeDoc);
          if (result === 'end') {
            state.reviewPendingResume = true;
            state.reviewResumeDirection = 'forward';
            await nextPage();
          }
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          const result = focusWordAbove(iframeDoc);
          if (result === 'start') {
            state.reviewPendingResume = true;
            state.reviewResumeDirection = 'backward';
            await prevPage();
          }
          break;
        }
        default: return; // don't preventDefault for unhandled keys
      }
      return;
    }

    // --- Reading mode ---
    // Panels/modals: only Escape and the panel's own toggle key should work
    const tocOpen = document.getElementById('toc-panel').classList.contains('open');
    const vocabOpen = state.vocab.panelEl?.classList.contains('open');

    switch (e.key) {
      case 'Escape':
        closeSettings();
        closeHelp();
        closeVocabPanel();
        document.getElementById('toc-panel').classList.remove('open');
        break;
      case 't':
      case 'T':
        if (!e.ctrlKey && !e.metaKey) toggleToc();
        break;
      case 'v':
      case 'V':
        if (!e.ctrlKey && !e.metaKey) {
          toggleVocabPanel(state.currentLanguage, { bookId: state.currentBookId, onStatsUpdate: updateStats, getIframeDocument });
        }
        break;
      case '?':
        toggleHelp();
        break;
      case 'f':
      case 'F':
        if (!e.ctrlKey && !e.metaKey) toggleFocusMode();
        break;
      default:
        // All other shortcuts are blocked when a panel is open
        if (tocOpen || vocabOpen) return;
        switch (e.key) {
          case 'ArrowLeft': prevPage(); break;
          case 'ArrowRight': nextPage(); break;
          case ' ':
            e.preventDefault();
            if (e.shiftKey) prevPage(); else nextPage();
            break;
          case 'Tab':
          case 'Enter':
            if (getIframeDocument()) {
              e.preventDefault();
              enterReviewMode(getIframeDocument());
              showReviewBar();
            }
            break;
          case 'k':
          case 'K':
            if (!e.ctrlKey && !e.metaKey) doMarkAllKnown();
            break;
          case 'w':
          case 'W':
            if (!e.ctrlKey && !e.metaKey) {
              if (document.getElementById('reader-area')?.classList.contains('open')) closeBook();
            }
            break;
        }
    }
  }));

  // TOC — single delegated handler so it doesn't accumulate on repeated book loads
  document.getElementById('btn-toc').addEventListener('click', safeHandler(toggleToc));
  document.getElementById('btn-close-toc').addEventListener('click', safeHandler(toggleToc));
  document.getElementById('toc-list').addEventListener('click', safeHandler((e) => {
    e.preventDefault();
    const a = e.target.closest('a[data-href]');
    if (a) {
      goToHref(a.dataset.href);
      document.getElementById('toc-panel').classList.remove('open');
    }
  }));

  // Focus mode
  document.getElementById('btn-focus').addEventListener('click', safeHandler(toggleFocusMode));
  document.getElementById('btn-exit-focus').addEventListener('click', safeHandler(exitFocusMode));
  document.getElementById('btn-focus-vocab').addEventListener('click', safeHandler(() => {
    return toggleVocabPanel(state.currentLanguage, { bookId: state.currentBookId, onStatsUpdate: updateStats, getIframeDocument });
  }));

  // Vocab browser
  document.getElementById('btn-vocab').addEventListener('click', safeHandler(() => {
    return toggleVocabPanel(state.currentLanguage, { bookId: state.currentBookId, onStatsUpdate: updateStats, getIframeDocument });
  }));

  // Close book
  document.getElementById('btn-close-book').addEventListener('click', safeHandler(closeBook));

  // Settings modal
  document.getElementById('btn-settings').addEventListener('click', safeHandler(openSettings));
  document.getElementById('btn-close-settings').addEventListener('click', safeHandler(closeSettings));
  document.querySelector('#settings-modal .modal-backdrop').addEventListener('click', safeHandler(closeSettings));
  document.querySelector('#settings-modal .modal-content').addEventListener('click', (e) => e.stopPropagation());
  document.getElementById('btn-save-dict').addEventListener('click', safeHandler(saveDict));
  document.getElementById('btn-reset-dict').addEventListener('click', safeHandler(resetDict));
  document.getElementById('dict-provider').addEventListener('change', safeHandler(onProviderChange));

  // Open book (from reader toolbar)
  document.getElementById('btn-open-book').addEventListener('click', () => {
    document.getElementById('file-input').click();
  });

  // Help modal — accessible from toolbar, focus bar, and keyboard (?)
  document.getElementById('btn-help').addEventListener('click', safeHandler(toggleHelp));
  document.getElementById('btn-focus-help').addEventListener('click', safeHandler(toggleHelp));
  document.getElementById('btn-close-help').addEventListener('click', safeHandler(closeHelp));
  document.querySelector('#help-modal .modal-backdrop').addEventListener('click', safeHandler(closeHelp));
  document.querySelector('#help-modal .modal-content').addEventListener('click', (e) => e.stopPropagation());

  // Export / Import
  document.getElementById('btn-export').addEventListener('click', safeHandler(doExport));
  document.getElementById('btn-import').addEventListener('click', safeHandler(() => {
    document.getElementById('import-input').click();
  }));
  document.getElementById('import-input').addEventListener('change', safeHandler(doImport));
}

async function openBook(file) {
  const viewer = document.getElementById('epub-viewer');

  try {
    let openedTocForEmpty = false;
    await loadEpub(file, viewer, state.currentLanguage, {
      onStatsUpdate: updateStats,
      onBookLoaded: (meta) => {
        document.getElementById('book-title').textContent = meta.title;
      },
      onEmptySection: () => {
        // First empty section (e.g. cover page) — open TOC so user can navigate
        if (!openedTocForEmpty) {
          openedTocForEmpty = true;
          document.getElementById('toc-panel').classList.add('open');
        }
      },
    });

    state.currentBookId = `${file.name}:${file.size}`;

    const toc = await getToc();
    document.getElementById('toc-list').innerHTML = renderTocItems(toc, 0);

    // Show reader ONLY after successful load
    document.getElementById('upload-area').classList.add('hidden');
    document.getElementById('reader-area').classList.add('open');
    document.getElementById('stats-bar').classList.remove('hidden');
    showReadingHint();

    // On mobile, auto-enter focus mode for maximum reading area
    if (window.matchMedia('(max-width: 600px)').matches) {
      document.getElementById('app').classList.add('focus-mode');
    }
  } catch (err) {
    console.error('Failed to open epub:', err);
    // Clean up partial state without touching UI (upload area stays visible)
    try { destroyEpub(); } catch (_) { /* ignore */ }
    state.currentBookId = null;
    showError('Could not open this file. Make sure it is a valid .epub file.');
  }
}

/** Wrap an event handler so errors are caught and shown instead of cascading. */
function safeHandler(fn) {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (err) {
      console.error('[hilight]', err);
      showError('Something went wrong. Try closing and reopening the book.');
    }
  };
}

async function doMarkAllKnown() {
  const iframeDoc = getIframeDocument();
  if (!iframeDoc) return;
  const prev = await markAllKnown(iframeDoc);
  await updateStats();
  if (prev.length === 0) return;
  showUndoToast(`Marked ${prev.length} words as known`, async () => {
    await restoreWordLevels(iframeDoc, prev);
    await updateStats();
  });
}

function renderTocItems(items, depth) {
  return items.map(item => {
    const indent = depth > 0 ? ` style="padding-left:${16 + depth * 16}px"` : '';
    let html = `<li><a href="#" data-href="${escapeHtml(item.href)}"${indent}>${escapeHtml(item.label.trim())}</a></li>`;
    if (item.subitems && item.subitems.length > 0) {
      html += renderTocItems(item.subitems, depth + 1);
    }
    return html;
  }).join('');
}

function closeBook() {
  state.currentBookId = null;
  // Cleanup may throw (e.g. partial init) — catch each so UI reset ALWAYS runs
  try { exitReviewMode(); hideReviewBar(); hideReadingHint(); } catch (_) { /* ignore */ }
  try { destroyEpub(); } catch (err) { console.error('[hilight] destroyEpub failed:', err); }
  try { closeVocabPanel(); } catch (err) { console.error('[hilight] closeVocabPanel failed:', err); }
  try { resetVocabBookState(); } catch (err) { console.error('[hilight] resetVocabBookState failed:', err); }
  // UI reset — always runs regardless of cleanup errors
  document.getElementById('app').classList.remove('focus-mode');
  document.getElementById('reader-area').classList.remove('open');
  document.getElementById('upload-area').classList.remove('hidden');
  document.getElementById('stats-bar').classList.add('hidden');
  document.getElementById('toc-panel').classList.remove('open');
  document.getElementById('toc-list').innerHTML = '';
}

function toggleToc() {
  closeVocabPanel();
  document.getElementById('toc-panel').classList.toggle('open');
}

function toggleFocusMode() {
  const app = document.getElementById('app');
  const entering = !app.classList.contains('focus-mode');
  if (entering) {
    // Close panels/modals before entering focus mode
    document.getElementById('toc-panel').classList.remove('open');
    closeVocabPanel();
    closeSettings();
    closeHelp();
  }
  app.classList.toggle('focus-mode');
}

function exitFocusMode() {
  document.getElementById('app').classList.remove('focus-mode');
}

async function updateStats() {
  const iframeDoc = getIframeDocument();
  // Page-scoped counts: all three from the current page's DOM
  const unknownOnPage = iframeDoc ? iframeDoc.querySelectorAll('.hl-word.hl-unknown').length : 0;
  const partialOnPage = iframeDoc ? iframeDoc.querySelectorAll('.hl-word.hl-partial').length : 0;
  const knownOnPage = iframeDoc ? iframeDoc.querySelectorAll('.hl-word.hl-known').length : 0;
  document.getElementById('stat-unknown').innerHTML = `? ${unknownOnPage} <span class="stat-label">unknown</span>`;
  document.getElementById('stat-partial').innerHTML = `~ ${partialOnPage} <span class="stat-label">learning</span>`;
  document.getElementById('stat-known').innerHTML = `\u2713 ${knownOnPage} <span class="stat-label">known</span>`;
  // DB total: how many words the user has saved across all pages
  const stats = await getStats(state.currentLanguage);
  document.getElementById('stat-saved').textContent = `\uD83D\uDCDA ${stats.total} saved`;
}

function openSettings() {
  const modal = document.getElementById('settings-modal');
  const langName = LANGUAGES.find(l => l.code === state.currentLanguage)?.name || state.currentLanguage;
  document.getElementById('settings-lang-name').textContent = langName;

  // Set the dropdown to the currently active provider
  const settings = loadDictSettings();
  const saved = settings[state.currentLanguage];
  // Handle old settings format: urlTemplate without provider means custom
  const activeId = (saved?.urlTemplate && !saved?.provider) ? 'custom' : getActiveProviderId(state.currentLanguage);
  const providerSelect = document.getElementById('dict-provider');
  providerSelect.value = activeId;

  // Load custom URL if saved
  document.getElementById('dict-url').value = saved?.urlTemplate || '';

  // Show/hide custom URL fields
  toggleCustomFields(activeId === 'custom');

  modal.classList.add('open');
}

function closeSettings() {
  document.getElementById('settings-modal').classList.remove('open');
}

function onProviderChange() {
  const selected = document.getElementById('dict-provider').value;
  toggleCustomFields(selected === 'custom');
}

function toggleCustomFields(show) {
  document.getElementById('custom-url-fields').style.display = show ? 'block' : 'none';
}

function saveDict() {
  const provider = document.getElementById('dict-provider').value;

  if (provider === 'custom') {
    const url = document.getElementById('dict-url').value.trim();
    if (!url) {
      document.getElementById('dict-url').focus();
      return;
    }
    const settings = loadDictSettings();
    settings[state.currentLanguage] = { provider: 'custom', urlTemplate: url };
    saveDictSettings(settings);
  } else {
    const settings = loadDictSettings();
    settings[state.currentLanguage] = { provider };
    saveDictSettings(settings);
  }

  // Flash save confirmation
  const btn = document.getElementById('btn-save-dict');
  btn.textContent = 'Saved!';
  btn.disabled = true;
  setTimeout(() => {
    btn.textContent = 'Save';
    btn.disabled = false;
    closeSettings();
  }, 600);
}

function resetDict() {
  const settings = loadDictSettings();
  delete settings[state.currentLanguage];
  saveDictSettings(settings);

  // Reset UI to defaults
  const defaultId = getActiveProviderId(state.currentLanguage);
  document.getElementById('dict-provider').value = defaultId;
  document.getElementById('dict-url').value = '';
  toggleCustomFields(false);
}

// --- Review mode helpers ---

async function gradeAndUpdate(level) {
  const span = getFocusedWord();
  if (!span) return;
  await setWordLevel(span, level, updateStats);
  state.reviewLastGrade = level;
}

async function quickAdvance() {
  if (state.reviewLastGrade !== null) {
    await gradeAndUpdate(state.reviewLastGrade);
  }
  const iframeDoc = getIframeDocument();
  const result = focusNextWord(iframeDoc);
  if (result === 'end') {
    state.reviewPendingResume = true;
    state.reviewResumeDirection = 'forward';
    await nextPage();
  }
}

function showDefForFocused() {
  const span = getFocusedWord();
  if (span) showWordDefinition(span);
}

function showReviewBar() {
  const bar = document.getElementById('review-bar');
  if (bar) bar.classList.add('visible');
  hideReadingHint();
  updateReviewBarFilter();
}

function hideReviewBar() {
  const bar = document.getElementById('review-bar');
  if (bar) bar.classList.remove('visible');
  showReadingHint();
}

function showReadingHint() {
  const hint = document.getElementById('reading-hint');
  if (hint) hint.classList.add('visible');
}

function hideReadingHint() {
  const hint = document.getElementById('reading-hint');
  if (hint) hint.classList.remove('visible');
}

function updateReviewBarFilter() {
  const el = document.getElementById('review-bar-filter');
  if (el) el.innerHTML = `<kbd>a</kbd> ${isShowingAll() ? 'unlearned' : 'all'}`;
}

// --- Help modal ---

function toggleHelp() {
  const modal = document.getElementById('help-modal');
  modal.classList.toggle('open');
}

function closeHelp() {
  document.getElementById('help-modal').classList.remove('open');
}

async function doExport() {
  const data = await exportVocab(state.currentLanguage);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `hilight-vocab-${state.currentLanguage}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function doImport(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    await importVocab(data);
    await updateStats();
  } catch (err) {
    console.error('Import failed:', err);
    showError('Import failed. Make sure the file is valid JSON exported from hilight.');
  }
  e.target.value = '';
}

// Surface async errors that would otherwise vanish silently
window.addEventListener('unhandledrejection', (event) => {
  console.error('[hilight] Unhandled async error:', event.reason);
  showError('Something went wrong. Check the console for details.');
});

// Warn before navigating away while a book is open (book data is in-memory only)
window.addEventListener('beforeunload', (e) => {
  if (document.getElementById('reader-area')?.classList.contains('open')) {
    e.preventDefault();
  }
});

// Boot
init();
