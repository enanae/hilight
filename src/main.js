import './style.css';
import { loadEpub, nextPage, prevPage, getToc, goToHref, getIframeDocument, destroyEpub, setLanguage } from './epub-reader.js';
import { getStats, exportVocab, importVocab } from './vocab-store.js';
import { saveDictSettings, loadDictSettings, hasDictionary, getActiveProviderId, getProviderChoices } from './dictionary.js';
import { isPopupActive, markAllKnown, restoreWordLevels } from './highlighter.js';
import { togglePanel as toggleVocabPanel, closePanel as closeVocabPanel, resetBookState as resetVocabBookState } from './vocab-browser.js';
import { state } from './app-state.js';

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
        <h1 class="logo">hilight</h1>
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
        <button id="btn-export" class="icon-btn" title="Export vocabulary as JSON" aria-label="Export vocabulary">&#8681;</button>
        <button id="btn-import" class="icon-btn" title="Import vocabulary from JSON" aria-label="Import vocabulary">&#8679;</button>
      </div>
    </header>

    <div class="stats-bar" id="stats-bar">
      <span id="stat-unknown" class="stat stat-unknown" title="Unknown words on this page">? 0</span>
      <span id="stat-partial" class="stat stat-partial" title="Learning words on this page">~ 0</span>
      <span id="stat-known" class="stat stat-known" title="Known words on this page">&#10003; 0</span>
      <span id="stat-saved" class="stat stat-saved" title="Total words saved across all pages">&#128218; 0 saved</span>
    </div>

    <main class="main-area">
      <div id="upload-area" class="upload-area">
        <div class="upload-content">
          <div class="upload-icon">&#128214;</div>
          <h2>Drop an epub file here</h2>
          <p>or click to browse</p>
          <input type="file" id="file-input" accept=".epub,application/epub+zip,application/octet-stream" hidden />
          <div class="upload-hint">
            <p>Every word starts highlighted. <strong>Tap</strong> a word to cycle:</p>
            <span class="demo-word demo-unknown">unknown</span>
            &#8594;
            <span class="demo-word demo-partial">learning</span>
            &#8594;
            <span class="demo-word demo-known">known</span>
            &#8594; ...
            <p class="hint-secondary"><strong>Long-press</strong> or <strong>double-click</strong> any word for a dictionary definition.</p>
          </div>
          <p class="upload-gutenberg">Need an epub? Browse free books at <a href="https://www.gutenberg.org/browse/languages/" target="_blank" rel="noopener">Project Gutenberg</a></p>
        </div>
      </div>

      <div id="reader-area" class="reader-area">
        <div class="reader-toolbar">
          <button id="btn-toc" class="toolbar-btn" title="Table of contents (T)">&#9776;<span class="btn-label"> Contents</span></button>
          <span id="book-title" class="book-title"></span>
          <button id="btn-mark-known" class="toolbar-btn" title="Mark all unknown words on this page as known (K)">&#10003;<span class="btn-label"> Page known</span></button>
          <button id="btn-vocab" class="toolbar-btn" title="Browse and manage your vocabulary list (V)">&#128218;<span class="btn-label"> Vocab</span></button>
          <button id="btn-close-book" class="toolbar-btn btn-close-book" title="Close this book and return to upload screen (W)">&#10005;<span class="btn-label"> Close book</span></button>
        </div>
        <div class="reader-nav">
          <button id="btn-prev" class="nav-btn" title="Previous">&lsaquo;</button>
          <div id="epub-viewer" class="epub-viewer"></div>
          <button id="btn-next" class="nav-btn" title="Next">&rsaquo;</button>
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

  // Navigation — suppressed while definition popup is showing
  document.getElementById('btn-prev').addEventListener('click', safeHandler(() => {
    if (!isPopupActive()) prevPage();
  }));
  document.getElementById('btn-next').addEventListener('click', safeHandler(() => {
    if (!isPopupActive()) nextPage();
  }));

  // Keyboard shortcuts — suppressed while popup showing or typing in inputs
  document.addEventListener('keydown', safeHandler(async (e) => {
    if (isPopupActive()) return;
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

    switch (e.key) {
      case 'ArrowLeft': prevPage(); break;
      case 'ArrowRight': nextPage(); break;
      case 'Escape':
        closeSettings();
        closeVocabPanel();
        document.getElementById('toc-panel').classList.remove('open');
        break;
      case 't':
      case 'T':
        if (!e.ctrlKey && !e.metaKey) toggleToc();
        break;
      case 'k':
      case 'K':
        if (!e.ctrlKey && !e.metaKey) {
          doMarkAllKnown();
        }
        break;
      case 'v':
      case 'V':
        if (!e.ctrlKey && !e.metaKey) {
          toggleVocabPanel(state.currentLanguage, { bookId: state.currentBookId, onStatsUpdate: updateStats, getIframeDocument });
        }
        break;
      case 'w':
      case 'W':
        if (!e.ctrlKey && !e.metaKey) {
          if (document.getElementById('reader-area')?.classList.contains('open')) closeBook();
        }
        break;
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

  // Vocab browser
  document.getElementById('btn-vocab').addEventListener('click', safeHandler(() => {
    return toggleVocabPanel(state.currentLanguage, { bookId: state.currentBookId, onStatsUpdate: updateStats, getIframeDocument });
  }));

  // Mark all words on page as known (with undo)
  document.getElementById('btn-mark-known').addEventListener('click', safeHandler(doMarkAllKnown));

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
    await loadEpub(file, viewer, state.currentLanguage, {
      onStatsUpdate: updateStats,
      onBookLoaded: (meta) => {
        document.getElementById('book-title').textContent = meta.title;
      },
    });

    state.currentBookId = `${file.name}:${file.size}`;

    const toc = await getToc();
    document.getElementById('toc-list').innerHTML = renderTocItems(toc, 0);

    // Show reader ONLY after successful load
    document.getElementById('upload-area').classList.add('hidden');
    document.getElementById('reader-area').classList.add('open');
  } catch (err) {
    console.error('Failed to open epub:', err);
    // Clean up partial state without touching UI (upload area stays visible)
    try { destroyEpub(); } catch (_) { /* ignore */ }
    state.currentBookId = null;
    showError('Could not open this file. Make sure it is a valid .epub file.');
  }
}

function showError(msg) {
  const existing = document.querySelector('.error-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'error-toast';
  toast.textContent = msg;
  document.getElementById('app').appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
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

function showUndoToast(message, onUndo) {
  const existing = document.querySelector('.undo-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'undo-toast';
  toast.innerHTML = `<span>${message}</span><button class="undo-btn">Undo</button>`;
  const btn = toast.querySelector('.undo-btn');
  let dismissed = false;
  btn.addEventListener('click', async () => {
    if (dismissed) return;
    dismissed = true;
    toast.remove();
    try {
      await onUndo();
    } catch (err) {
      console.error('[hilight] Undo failed:', err);
      showError('Undo failed. Check the console for details.');
    }
  });
  document.getElementById('app').appendChild(toast);
  setTimeout(() => {
    dismissed = true;
    toast.remove();
  }, 6000);
}

function renderTocItems(items, depth) {
  return items.map(item => {
    const indent = depth > 0 ? ` style="padding-left:${16 + depth * 16}px"` : '';
    let html = `<li><a href="#" data-href="${item.href}"${indent}>${item.label.trim()}</a></li>`;
    if (item.subitems && item.subitems.length > 0) {
      html += renderTocItems(item.subitems, depth + 1);
    }
    return html;
  }).join('');
}

function closeBook() {
  state.currentBookId = null;
  // Cleanup may throw (e.g. partial init) — catch each so UI reset ALWAYS runs
  try { destroyEpub(); } catch (err) { console.error('[hilight] destroyEpub failed:', err); }
  try { closeVocabPanel(); } catch (err) { console.error('[hilight] closeVocabPanel failed:', err); }
  try { resetVocabBookState(); } catch (err) { console.error('[hilight] resetVocabBookState failed:', err); }
  // UI reset — always runs regardless of cleanup errors
  document.getElementById('reader-area').classList.remove('open');
  document.getElementById('upload-area').classList.remove('hidden');
  document.getElementById('toc-panel').classList.remove('open');
  document.getElementById('toc-list').innerHTML = '';
}

function toggleToc() {
  closeVocabPanel();
  document.getElementById('toc-panel').classList.toggle('open');
}

async function updateStats() {
  const iframeDoc = getIframeDocument();
  // Page-scoped counts: all three from the current page's DOM
  const unknownOnPage = iframeDoc ? iframeDoc.querySelectorAll('.hl-word.hl-unknown').length : 0;
  const partialOnPage = iframeDoc ? iframeDoc.querySelectorAll('.hl-word.hl-partial').length : 0;
  const knownOnPage = iframeDoc ? iframeDoc.querySelectorAll('.hl-word.hl-known').length : 0;
  document.getElementById('stat-unknown').textContent = `? ${unknownOnPage}`;
  document.getElementById('stat-partial').textContent = `~ ${partialOnPage}`;
  document.getElementById('stat-known').textContent = `\u2713 ${knownOnPage}`;
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
