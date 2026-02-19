import './style.css';
import { loadEpub, nextPage, prevPage, getToc, goToHref } from './epub-reader.js';
import { getStats, exportVocab, importVocab } from './vocab-store.js';
import { saveDictSettings, loadDictSettings, hasDictionary } from './dictionary.js';

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

let currentLanguage = localStorage.getItem('hilight-lang') || 'en';

/** Initialize the app. */
function init() {
  renderApp();
  bindEvents();
  updateStats();
}

function renderApp() {
  document.querySelector('#app').innerHTML = `
    <header class="app-header">
      <div class="header-left">
        <h1 class="logo">hilight</h1>
        <span class="tagline">free epub vocabulary builder</span>
      </div>
      <div class="header-right">
        <select id="lang-select" aria-label="Language">
          ${LANGUAGES.map(l =>
            `<option value="${l.code}" ${l.code === currentLanguage ? 'selected' : ''}>${l.name}</option>`
          ).join('')}
        </select>
        <button id="btn-settings" class="icon-btn" title="Dictionary settings">&#9881;</button>
        <button id="btn-export" class="icon-btn" title="Export vocabulary">&#8681;</button>
        <button id="btn-import" class="icon-btn" title="Import vocabulary">&#8679;</button>
      </div>
    </header>

    <div class="stats-bar" id="stats-bar">
      <span id="stat-unknown" class="stat stat-unknown" title="Unknown words">? 0</span>
      <span id="stat-partial" class="stat stat-partial" title="Learning">~ 0</span>
      <span id="stat-known" class="stat stat-known" title="Known">&#10003; 0</span>
    </div>

    <main class="main-area">
      <div id="upload-area" class="upload-area">
        <div class="upload-content">
          <div class="upload-icon">&#128214;</div>
          <h2>Drop an epub file here</h2>
          <p>or click to browse</p>
          <input type="file" id="file-input" accept=".epub" hidden />
          <div class="upload-hint">
            <p>Every word starts highlighted. Click a word to cycle:</p>
            <span class="demo-word demo-unknown">unknown</span>
            &#8594;
            <span class="demo-word demo-partial">learning</span>
            &#8594;
            <span class="demo-word demo-known">known</span>
            &#8594; ...
          </div>
        </div>
      </div>

      <div id="reader-area" class="reader-area" hidden>
        <div class="reader-toolbar">
          <button id="btn-toc" class="toolbar-btn" title="Table of contents">&#9776; TOC</button>
          <span id="book-title" class="book-title"></span>
          <button id="btn-close-book" class="toolbar-btn" title="Close book">&#10005;</button>
        </div>
        <div class="reader-nav">
          <button id="btn-prev" class="nav-btn" title="Previous">&lsaquo;</button>
          <div id="epub-viewer" class="epub-viewer"></div>
          <button id="btn-next" class="nav-btn" title="Next">&rsaquo;</button>
        </div>
      </div>

      <div id="toc-panel" class="toc-panel" hidden>
        <div class="toc-header">
          <strong>Table of Contents</strong>
          <button id="btn-close-toc" class="toolbar-btn">&#10005;</button>
        </div>
        <ul id="toc-list" class="toc-list"></ul>
      </div>
    </main>

    <!-- Settings modal -->
    <div id="settings-modal" class="modal" hidden>
      <div class="modal-content">
        <div class="modal-header">
          <h2>Dictionary Settings</h2>
          <button id="btn-close-settings" class="toolbar-btn">&#10005;</button>
        </div>
        <div class="modal-body">
          <p>Configure a dictionary API for <strong id="settings-lang-name"></strong>.</p>
          <p class="hint">Use <code>{word}</code> as a placeholder in the URL. The API should return JSON.</p>
          <label>
            API URL template:
            <input type="text" id="dict-url" class="input-full"
              placeholder="https://api.example.com/lookup/{word}" />
          </label>
          <label>
            Display name:
            <input type="text" id="dict-name" class="input-full" placeholder="My Dictionary" />
          </label>
          <div class="modal-actions">
            <button id="btn-save-dict" class="btn-primary">Save</button>
            <button id="btn-clear-dict" class="btn-secondary">Clear</button>
          </div>
          <p class="hint" id="dict-builtin-note"></p>
        </div>
      </div>
    </div>

    <input type="file" id="import-input" accept=".json" hidden />
  `;
}

function bindEvents() {
  const uploadArea = document.getElementById('upload-area');
  const fileInput = document.getElementById('file-input');

  // File upload
  uploadArea.addEventListener('click', () => fileInput.click());
  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('drag-over');
  });
  uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('drag-over');
  });
  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.epub')) openBook(file);
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) openBook(fileInput.files[0]);
  });

  // Language select
  document.getElementById('lang-select').addEventListener('change', (e) => {
    currentLanguage = e.target.value;
    localStorage.setItem('hilight-lang', currentLanguage);
    updateStats();
  });

  // Navigation
  document.getElementById('btn-prev').addEventListener('click', () => prevPage());
  document.getElementById('btn-next').addEventListener('click', () => nextPage());

  // Keyboard nav
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') prevPage();
    if (e.key === 'ArrowRight') nextPage();
  });

  // TOC
  document.getElementById('btn-toc').addEventListener('click', toggleToc);
  document.getElementById('btn-close-toc').addEventListener('click', toggleToc);

  // Close book
  document.getElementById('btn-close-book').addEventListener('click', closeBook);

  // Settings
  document.getElementById('btn-settings').addEventListener('click', openSettings);
  document.getElementById('btn-close-settings').addEventListener('click', closeSettings);
  document.getElementById('btn-save-dict').addEventListener('click', saveDict);
  document.getElementById('btn-clear-dict').addEventListener('click', clearDict);

  // Export / Import
  document.getElementById('btn-export').addEventListener('click', doExport);
  document.getElementById('btn-import').addEventListener('click', () => {
    document.getElementById('import-input').click();
  });
  document.getElementById('import-input').addEventListener('change', doImport);
}

async function openBook(file) {
  const uploadArea = document.getElementById('upload-area');
  const readerArea = document.getElementById('reader-area');
  const viewer = document.getElementById('epub-viewer');

  uploadArea.hidden = true;
  readerArea.hidden = false;

  await loadEpub(file, viewer, currentLanguage, {
    onStatsUpdate: updateStats,
    onBookLoaded: (meta) => {
      document.getElementById('book-title').textContent = meta.title;
    },
  });

  // Load TOC
  const toc = await getToc();
  const tocList = document.getElementById('toc-list');
  tocList.innerHTML = toc.map(item =>
    `<li><a href="#" data-href="${item.href}">${item.label}</a></li>`
  ).join('');
  tocList.addEventListener('click', (e) => {
    e.preventDefault();
    const href = e.target.dataset.href;
    if (href) {
      goToHref(href);
      document.getElementById('toc-panel').hidden = true;
    }
  });
}

function closeBook() {
  document.getElementById('reader-area').hidden = true;
  document.getElementById('upload-area').hidden = false;
  document.getElementById('toc-panel').hidden = true;
}

function toggleToc() {
  const panel = document.getElementById('toc-panel');
  panel.hidden = !panel.hidden;
}

async function updateStats() {
  const stats = await getStats(currentLanguage);
  // Count unique words on page that are unknown
  const unknownOnPage = document.querySelectorAll('.hl-word.hl-unknown').length;
  document.getElementById('stat-unknown').textContent = `? ${unknownOnPage}`;
  document.getElementById('stat-partial').textContent = `~ ${stats.partial}`;
  document.getElementById('stat-known').textContent = `\u2713 ${stats.known}`;
}

function openSettings() {
  const modal = document.getElementById('settings-modal');
  const langName = LANGUAGES.find(l => l.code === currentLanguage)?.name || currentLanguage;
  document.getElementById('settings-lang-name').textContent = langName;

  const settings = loadDictSettings();
  const current = settings[currentLanguage];
  document.getElementById('dict-url').value = current?.urlTemplate || '';
  document.getElementById('dict-name').value = current?.name || '';

  const builtinNote = document.getElementById('dict-builtin-note');
  if (currentLanguage === 'en') {
    builtinNote.textContent = 'English has a built-in free dictionary. You can override it with a custom API.';
  } else {
    builtinNote.textContent = '';
  }

  modal.hidden = false;
}

function closeSettings() {
  document.getElementById('settings-modal').hidden = true;
}

function saveDict() {
  const url = document.getElementById('dict-url').value.trim();
  const name = document.getElementById('dict-name').value.trim() || 'Custom Dictionary';
  if (!url) return;

  const settings = loadDictSettings();
  settings[currentLanguage] = { urlTemplate: url, name };
  saveDictSettings(settings);
  closeSettings();
}

function clearDict() {
  const settings = loadDictSettings();
  delete settings[currentLanguage];
  saveDictSettings(settings);
  document.getElementById('dict-url').value = '';
  document.getElementById('dict-name').value = '';
}

async function doExport() {
  const data = await exportVocab(currentLanguage);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `hilight-vocab-${currentLanguage}.json`;
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
    updateStats();
  } catch (err) {
    console.error('Import failed:', err);
  }
  e.target.value = '';
}

// Boot
init();
