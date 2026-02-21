/**
 * Domain: Application Shell
 * Subdomain: Rendering, Navigation, Keyboard Shortcuts, Settings, Stats, Import/Export
 *
 * main.js calls init() on import, so we must set up the #app element and mock
 * all dependencies BEFORE the dynamic import in beforeAll.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

// ── Mock ALL dependencies before main.js is imported ────────────────────

vi.mock('../src/epub-reader.js', () => ({
  loadEpub: vi.fn(async () => ({ book: {}, rendition: {} })),
  nextPage: vi.fn(),
  prevPage: vi.fn(),
  getToc: vi.fn(async () => []),
  goToHref: vi.fn(),
  getIframeDocument: vi.fn(() => null),
  destroyEpub: vi.fn(),
  setLanguage: vi.fn(async () => {}),
  getBookId: vi.fn(() => 'test-book-id'),
}));

vi.mock('../src/vocab-store.js', () => ({
  getStats: vi.fn(async () => ({ partial: 0, known: 0, total: 0 })),
  exportVocab: vi.fn(async () => []),
  importVocab: vi.fn(async () => {}),
}));

vi.mock('../src/dictionary.js', () => ({
  saveDictSettings: vi.fn(),
  loadDictSettings: vi.fn(() => ({})),
  hasDictionary: vi.fn(() => true),
  getActiveProviderId: vi.fn(() => 'free-dict'),
  getProviderChoices: vi.fn(() => [
    { id: 'wiktionary', name: 'Wiktionary', description: 'Free dictionary' },
    { id: 'free-dict', name: 'Free Dictionary', description: 'English dictionary' },
  ]),
}));

vi.mock('../src/highlighter.js', () => ({
  popupActive: false,
  markAllKnown: vi.fn(async () => []),
  restoreWordLevels: vi.fn(async () => {}),
}));

vi.mock('../src/vocab-browser.js', () => ({
  togglePanel: vi.fn(),
  closePanel: vi.fn(),
  resetBookState: vi.fn(),
}));

vi.mock('../src/style.css', () => ({}));

// ── Import the mocked modules so we can inspect calls ───────────────────

import { nextPage, prevPage, setLanguage, getIframeDocument, destroyEpub, goToHref, getBookId } from '../src/epub-reader.js';
import { getStats, exportVocab, importVocab } from '../src/vocab-store.js';
import { saveDictSettings, loadDictSettings, getActiveProviderId } from '../src/dictionary.js';
import { markAllKnown, restoreWordLevels } from '../src/highlighter.js';
import { togglePanel as toggleVocabPanel, closePanel as closeVocabPanel, resetBookState as resetVocabBookState } from '../src/vocab-browser.js';
import * as highlighterModule from '../src/highlighter.js';

// ── Bootstrap: create #app then dynamically import main.js ──────────────

beforeAll(async () => {
  document.body.innerHTML = '<div id="app"></div>';
  await import('../src/main.js');
});

beforeEach(() => {
  vi.clearAllMocks();
  // Reset any classes that tests may have toggled
  document.getElementById('toc-panel')?.classList.remove('open');
  document.getElementById('settings-modal')?.classList.remove('open');
  // Reset save button state (saveDict disables it for 600ms after successful save)
  const saveBtn = document.getElementById('btn-save-dict');
  if (saveBtn) {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save';
  }
});

// ── Subdomain: App Rendering ────────────────────────────────────────────

describe('App Rendering', () => {
  it('renders the app header with logo and tagline', () => {
    const header = document.querySelector('.app-header');
    expect(header).not.toBeNull();
    expect(header.querySelector('.logo').textContent).toBe('hilight');
    expect(header.querySelector('.tagline').textContent).toContain('free epub vocabulary builder');
  });

  it('renders both language select dropdowns', () => {
    const langSelect = document.getElementById('lang-select');
    const defLangSelect = document.getElementById('def-lang-select');
    expect(langSelect).not.toBeNull();
    expect(defLangSelect).not.toBeNull();
    expect(langSelect.tagName).toBe('SELECT');
    expect(defLangSelect.tagName).toBe('SELECT');
  });

  it('renders the stats bar with all four stat elements', () => {
    expect(document.getElementById('stats-bar')).not.toBeNull();
    expect(document.getElementById('stat-unknown')).not.toBeNull();
    expect(document.getElementById('stat-partial')).not.toBeNull();
    expect(document.getElementById('stat-known')).not.toBeNull();
    expect(document.getElementById('stat-saved')).not.toBeNull();
  });

  it('renders the upload area with a hidden file input', () => {
    const uploadArea = document.getElementById('upload-area');
    expect(uploadArea).not.toBeNull();
    const fileInput = document.getElementById('file-input');
    expect(fileInput).not.toBeNull();
    expect(fileInput.type).toBe('file');
    expect(fileInput.hidden).toBe(true);
    expect(fileInput.accept).toContain('.epub');
  });

  it('renders the reader area with navigation buttons and toolbar', () => {
    const readerArea = document.getElementById('reader-area');
    expect(readerArea).not.toBeNull();
    expect(document.getElementById('btn-prev')).not.toBeNull();
    expect(document.getElementById('btn-next')).not.toBeNull();
    expect(document.getElementById('btn-toc')).not.toBeNull();
    expect(document.getElementById('btn-mark-known')).not.toBeNull();
    expect(document.getElementById('btn-vocab')).not.toBeNull();
    expect(document.getElementById('btn-close-book')).not.toBeNull();
  });

  it('renders the settings modal with provider select and action buttons', () => {
    const modal = document.getElementById('settings-modal');
    expect(modal).not.toBeNull();
    expect(document.getElementById('dict-provider')).not.toBeNull();
    expect(document.getElementById('btn-save-dict')).not.toBeNull();
    expect(document.getElementById('btn-reset-dict')).not.toBeNull();
    expect(document.getElementById('btn-close-settings')).not.toBeNull();
  });

  it('renders the TOC panel with close button and empty list', () => {
    const tocPanel = document.getElementById('toc-panel');
    expect(tocPanel).not.toBeNull();
    expect(document.getElementById('btn-close-toc')).not.toBeNull();
    expect(document.getElementById('toc-list')).not.toBeNull();
  });

  it('renders the hidden import input', () => {
    const importInput = document.getElementById('import-input');
    expect(importInput).not.toBeNull();
    expect(importInput.type).toBe('file');
    expect(importInput.accept).toBe('.json');
    expect(importInput.hidden).toBe(true);
  });
});

// ── Subdomain: Language Configuration ───────────────────────────────────

describe('Language Configuration', () => {
  it('contains all 18 languages in the book language dropdown', () => {
    const langSelect = document.getElementById('lang-select');
    const options = langSelect.querySelectorAll('option');
    expect(options.length).toBe(18);

    const codes = Array.from(options).map(o => o.value);
    expect(codes).toContain('en');
    expect(codes).toContain('es');
    expect(codes).toContain('fr');
    expect(codes).toContain('de');
    expect(codes).toContain('ja');
    expect(codes).toContain('ko');
    expect(codes).toContain('zh');
    expect(codes).toContain('sv');
  });

  it('contains all 18 languages in the definition language dropdown', () => {
    const defLangSelect = document.getElementById('def-lang-select');
    const options = defLangSelect.querySelectorAll('option');
    expect(options.length).toBe(18);
  });

  it('defaults the book language to English', () => {
    const langSelect = document.getElementById('lang-select');
    expect(langSelect.value).toBe('en');
  });

  it('defaults the definition language to English', () => {
    const defLangSelect = document.getElementById('def-lang-select');
    expect(defLangSelect.value).toBe('en');
  });

  it('calls setLanguage and updateStats when book language changes', async () => {
    const langSelect = document.getElementById('lang-select');
    langSelect.value = 'fr';
    langSelect.dispatchEvent(new Event('change', { bubbles: true }));

    // setLanguage is async, give it a tick
    await vi.waitFor(() => {
      expect(setLanguage).toHaveBeenCalledWith('fr');
    });
  });

  it('stores definition language in localStorage on change', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem');
    const defLangSelect = document.getElementById('def-lang-select');
    defLangSelect.value = 'es';
    defLangSelect.dispatchEvent(new Event('change', { bubbles: true }));

    expect(spy).toHaveBeenCalledWith('hilight-def-lang', 'es');
    spy.mockRestore();
  });
});

// ── Subdomain: Stats Display ────────────────────────────────────────────

describe('Stats Display', () => {
  it('shows initial zero counts after init', () => {
    expect(document.getElementById('stat-unknown').textContent).toContain('0');
    expect(document.getElementById('stat-partial').textContent).toContain('0');
    expect(document.getElementById('stat-known').textContent).toContain('0');
  });

  it('updates stats from iframe DOM word counts', async () => {
    // Create a fake iframe document with highlighted words
    const fakeDoc = document.createElement('div');
    fakeDoc.innerHTML = `
      <span class="hl-word hl-unknown">a</span>
      <span class="hl-word hl-unknown">b</span>
      <span class="hl-word hl-unknown">c</span>
      <span class="hl-word hl-partial">d</span>
      <span class="hl-word hl-known">e</span>
      <span class="hl-word hl-known">f</span>
    `;
    // Give the fake doc a querySelectorAll that works
    getIframeDocument.mockReturnValue(fakeDoc);
    getStats.mockResolvedValue({ partial: 5, known: 10, total: 15 });

    // Trigger stats update by changing language
    const langSelect = document.getElementById('lang-select');
    langSelect.value = 'en';
    langSelect.dispatchEvent(new Event('change', { bubbles: true }));

    await vi.waitFor(() => {
      expect(document.getElementById('stat-unknown').textContent).toBe('? 3');
      expect(document.getElementById('stat-partial').textContent).toBe('~ 1');
      expect(document.getElementById('stat-known').textContent).toBe('\u2713 2');
      expect(document.getElementById('stat-saved').textContent).toContain('15 saved');
    });
  });

  it('shows zero counts when no iframe document is available', async () => {
    getIframeDocument.mockReturnValue(null);
    getStats.mockResolvedValue({ partial: 0, known: 0, total: 0 });

    const langSelect = document.getElementById('lang-select');
    langSelect.value = 'en';
    langSelect.dispatchEvent(new Event('change', { bubbles: true }));

    await vi.waitFor(() => {
      expect(document.getElementById('stat-unknown').textContent).toBe('? 0');
      expect(document.getElementById('stat-partial').textContent).toBe('~ 0');
      expect(document.getElementById('stat-known').textContent).toBe('\u2713 0');
    });
  });
});

// ── Subdomain: Navigation Buttons ───────────────────────────────────────

describe('Navigation Buttons', () => {
  it('calls prevPage when the prev button is clicked', () => {
    document.getElementById('btn-prev').click();
    expect(prevPage).toHaveBeenCalledTimes(1);
  });

  it('calls nextPage when the next button is clicked', () => {
    document.getElementById('btn-next').click();
    expect(nextPage).toHaveBeenCalledTimes(1);
  });

  it('suppresses navigation when popupActive is true', () => {
    // Temporarily set popupActive to true
    Object.defineProperty(highlighterModule, 'popupActive', {
      value: true,
      writable: true,
      configurable: true,
    });

    document.getElementById('btn-prev').click();
    document.getElementById('btn-next').click();
    expect(prevPage).not.toHaveBeenCalled();
    expect(nextPage).not.toHaveBeenCalled();

    // Restore
    Object.defineProperty(highlighterModule, 'popupActive', {
      value: false,
      writable: true,
      configurable: true,
    });
  });
});

// ── Subdomain: Keyboard Shortcuts ───────────────────────────────────────

describe('Keyboard Shortcuts', () => {
  function pressKey(key, opts = {}) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...opts }));
  }

  it('ArrowLeft triggers prevPage', () => {
    pressKey('ArrowLeft');
    expect(prevPage).toHaveBeenCalledTimes(1);
  });

  it('ArrowRight triggers nextPage', () => {
    pressKey('ArrowRight');
    expect(nextPage).toHaveBeenCalledTimes(1);
  });

  it('Escape closes settings modal, vocab panel, and TOC', () => {
    // Open them first
    document.getElementById('settings-modal').classList.add('open');
    document.getElementById('toc-panel').classList.add('open');

    pressKey('Escape');

    expect(document.getElementById('settings-modal').classList.contains('open')).toBe(false);
    expect(document.getElementById('toc-panel').classList.contains('open')).toBe(false);
    expect(closeVocabPanel).toHaveBeenCalled();
  });

  it('t toggles the TOC panel', () => {
    expect(document.getElementById('toc-panel').classList.contains('open')).toBe(false);
    pressKey('t');
    expect(document.getElementById('toc-panel').classList.contains('open')).toBe(true);
    pressKey('t');
    expect(document.getElementById('toc-panel').classList.contains('open')).toBe(false);
  });

  it('T (uppercase) also toggles the TOC panel', () => {
    pressKey('T');
    expect(document.getElementById('toc-panel').classList.contains('open')).toBe(true);
  });

  it('v opens the vocab panel', () => {
    pressKey('v');
    expect(toggleVocabPanel).toHaveBeenCalled();
  });

  it('k calls doMarkAllKnown (via markAllKnown)', () => {
    const fakeDoc = document.createElement('div');
    getIframeDocument.mockReturnValue(fakeDoc);
    pressKey('k');
    expect(markAllKnown).toHaveBeenCalledWith(fakeDoc);
  });

  it('w closes the book when reader is open', () => {
    document.getElementById('reader-area').classList.add('open');
    pressKey('w');
    expect(destroyEpub).toHaveBeenCalled();
    expect(document.getElementById('reader-area').classList.contains('open')).toBe(false);
  });

  it('w does nothing when reader is not open', () => {
    document.getElementById('reader-area').classList.remove('open');
    pressKey('w');
    expect(destroyEpub).not.toHaveBeenCalled();
  });

  it('suppresses shortcuts when typing in an INPUT element', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(prevPage).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it('suppresses shortcuts when focus is on a SELECT element', () => {
    const select = document.getElementById('lang-select');
    select.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(nextPage).not.toHaveBeenCalled();
  });

  it('suppresses shortcuts when focus is on a TEXTAREA element', () => {
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(prevPage).not.toHaveBeenCalled();
    document.body.removeChild(textarea);
  });

  it('does not trigger t shortcut when ctrlKey is held', () => {
    pressKey('t', { ctrlKey: true });
    expect(document.getElementById('toc-panel').classList.contains('open')).toBe(false);
  });

  it('does not trigger k shortcut when metaKey is held', () => {
    getIframeDocument.mockReturnValue(document.createElement('div'));
    pressKey('k', { metaKey: true });
    expect(markAllKnown).not.toHaveBeenCalled();
  });
});

// ── Subdomain: TOC Toggle ───────────────────────────────────────────────

describe('TOC Toggle', () => {
  it('toggles open class on toc-panel when btn-toc is clicked', () => {
    const tocPanel = document.getElementById('toc-panel');
    expect(tocPanel.classList.contains('open')).toBe(false);

    document.getElementById('btn-toc').click();
    expect(tocPanel.classList.contains('open')).toBe(true);

    document.getElementById('btn-toc').click();
    expect(tocPanel.classList.contains('open')).toBe(false);
  });

  it('closes toc-panel when btn-close-toc is clicked', () => {
    const tocPanel = document.getElementById('toc-panel');
    document.getElementById('btn-toc').click();
    expect(tocPanel.classList.contains('open')).toBe(true);

    document.getElementById('btn-close-toc').click();
    expect(tocPanel.classList.contains('open')).toBe(false);
  });

  it('closes the vocab panel when toggling TOC', () => {
    document.getElementById('btn-toc').click();
    expect(closeVocabPanel).toHaveBeenCalled();
  });

  it('navigates to href when a TOC link is clicked', () => {
    const tocList = document.getElementById('toc-list');
    tocList.innerHTML = '<li><a href="#" data-href="chapter1.html">Chapter 1</a></li>';

    const link = tocList.querySelector('a');
    link.click();

    expect(goToHref).toHaveBeenCalledWith('chapter1.html');
    expect(document.getElementById('toc-panel').classList.contains('open')).toBe(false);
  });
});

// ── Subdomain: Settings Modal ───────────────────────────────────────────

describe('Settings Modal', () => {
  it('opens the settings modal when btn-settings is clicked', () => {
    const modal = document.getElementById('settings-modal');
    expect(modal.classList.contains('open')).toBe(false);
    document.getElementById('btn-settings').click();
    expect(modal.classList.contains('open')).toBe(true);
  });

  it('shows the current language name in the modal', () => {
    document.getElementById('btn-settings').click();
    const langLabel = document.getElementById('settings-lang-name');
    // currentLanguage may have been changed in earlier tests; just verify it's populated
    expect(langLabel.textContent.length).toBeGreaterThan(0);
  });

  it('closes the settings modal when btn-close-settings is clicked', () => {
    const modal = document.getElementById('settings-modal');
    document.getElementById('btn-settings').click();
    expect(modal.classList.contains('open')).toBe(true);

    document.getElementById('btn-close-settings').click();
    expect(modal.classList.contains('open')).toBe(false);
  });

  it('closes the settings modal when clicking the backdrop', () => {
    const modal = document.getElementById('settings-modal');
    document.getElementById('btn-settings').click();
    expect(modal.classList.contains('open')).toBe(true);

    const backdrop = modal.querySelector('.modal-backdrop');
    backdrop.click();
    expect(modal.classList.contains('open')).toBe(false);
  });

  it('shows provider options in the dict-provider select', () => {
    const providerSelect = document.getElementById('dict-provider');
    const options = providerSelect.querySelectorAll('option');
    const values = Array.from(options).map(o => o.value);
    expect(values).toContain('wiktionary');
    expect(values).toContain('free-dict');
    expect(values).toContain('custom');
  });

  it('saves dict settings when btn-save-dict is clicked with a built-in provider', () => {
    document.getElementById('btn-settings').click();
    const providerSelect = document.getElementById('dict-provider');
    providerSelect.value = 'wiktionary';

    document.getElementById('btn-save-dict').click();

    expect(saveDictSettings).toHaveBeenCalled();
    const savedArg = saveDictSettings.mock.calls[0][0];
    // Find the entry for the current language
    const langKeys = Object.keys(savedArg);
    expect(langKeys.length).toBeGreaterThan(0);
    const entry = savedArg[langKeys[0]];
    expect(entry.provider).toBe('wiktionary');
  });

  it('resets dict settings when btn-reset-dict is clicked', () => {
    document.getElementById('btn-settings').click();
    document.getElementById('btn-reset-dict').click();

    expect(saveDictSettings).toHaveBeenCalled();
    expect(getActiveProviderId).toHaveBeenCalled();
  });

  it('shows custom URL fields when custom provider is selected', () => {
    document.getElementById('btn-settings').click();
    const providerSelect = document.getElementById('dict-provider');
    providerSelect.value = 'custom';
    providerSelect.dispatchEvent(new Event('change', { bubbles: true }));

    const customFields = document.getElementById('custom-url-fields');
    expect(customFields.style.display).toBe('block');
  });

  it('hides custom URL fields when a built-in provider is selected', () => {
    document.getElementById('btn-settings').click();
    const providerSelect = document.getElementById('dict-provider');
    providerSelect.value = 'free-dict';
    providerSelect.dispatchEvent(new Event('change', { bubbles: true }));

    const customFields = document.getElementById('custom-url-fields');
    expect(customFields.style.display).toBe('none');
  });

  it('does not save custom provider when URL is empty', () => {
    document.getElementById('btn-settings').click();
    const providerSelect = document.getElementById('dict-provider');
    providerSelect.value = 'custom';
    providerSelect.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('dict-url').value = '';

    document.getElementById('btn-save-dict').click();
    expect(saveDictSettings).not.toHaveBeenCalled();
  });

  it('saves custom URL when custom provider is selected and URL is provided', () => {
    loadDictSettings.mockReturnValue({});
    document.getElementById('btn-settings').click();
    const providerSelect = document.getElementById('dict-provider');
    providerSelect.value = 'custom';
    providerSelect.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('dict-url').value = 'https://api.example.com/{lang}/{word}';

    document.getElementById('btn-save-dict').click();

    expect(saveDictSettings).toHaveBeenCalled();
    const savedArg = saveDictSettings.mock.calls[0][0];
    const entry = Object.values(savedArg)[0];
    expect(entry.provider).toBe('custom');
    expect(entry.urlTemplate).toBe('https://api.example.com/{lang}/{word}');
  });
});

// ── Subdomain: Upload Area ──────────────────────────────────────────────

describe('Upload Area', () => {
  it('contains a file input that accepts epub files', () => {
    const fileInput = document.getElementById('file-input');
    expect(fileInput.accept).toContain('.epub');
  });

  it('adds drag-over class during dragover and removes on dragleave', () => {
    const uploadArea = document.getElementById('upload-area');

    uploadArea.dispatchEvent(new Event('dragover', { bubbles: true }));
    expect(uploadArea.classList.contains('drag-over')).toBe(true);

    uploadArea.dispatchEvent(new Event('dragleave', { bubbles: true }));
    expect(uploadArea.classList.contains('drag-over')).toBe(false);
  });

  it('contains upload instructions and a link to Project Gutenberg', () => {
    const uploadArea = document.getElementById('upload-area');
    expect(uploadArea.textContent).toContain('Drop an epub file here');
    const gutenbergLink = uploadArea.querySelector('a[href*="gutenberg.org"]');
    expect(gutenbergLink).not.toBeNull();
  });
});

// ── Subdomain: Close Book ───────────────────────────────────────────────

describe('Close Book', () => {
  it('resets reader state when btn-close-book is clicked', () => {
    // Set up open state
    document.getElementById('reader-area').classList.add('open');
    document.getElementById('upload-area').classList.add('hidden');
    document.getElementById('toc-panel').classList.add('open');
    document.getElementById('toc-list').innerHTML = '<li>Chapter</li>';

    document.getElementById('btn-close-book').click();

    expect(destroyEpub).toHaveBeenCalled();
    expect(closeVocabPanel).toHaveBeenCalled();
    expect(resetVocabBookState).toHaveBeenCalled();
    expect(document.getElementById('reader-area').classList.contains('open')).toBe(false);
    expect(document.getElementById('upload-area').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('toc-panel').classList.contains('open')).toBe(false);
    expect(document.getElementById('toc-list').innerHTML).toBe('');
  });
});

// ── Subdomain: Vocab Panel ──────────────────────────────────────────────

describe('Vocab Panel', () => {
  it('toggles the vocab panel when btn-vocab is clicked', () => {
    document.getElementById('btn-vocab').click();
    expect(toggleVocabPanel).toHaveBeenCalled();
  });

  it('passes bookId and onStatsUpdate options to togglePanel', () => {
    document.getElementById('btn-vocab').click();
    const args = toggleVocabPanel.mock.calls[0];
    expect(args[1]).toHaveProperty('bookId');
    expect(args[1]).toHaveProperty('onStatsUpdate');
    expect(typeof args[1].onStatsUpdate).toBe('function');
  });
});

// ── Subdomain: Mark All Known ───────────────────────────────────────────

describe('Mark All Known', () => {
  it('does nothing when there is no iframe document', () => {
    getIframeDocument.mockReturnValue(null);
    document.getElementById('btn-mark-known').click();
    expect(markAllKnown).not.toHaveBeenCalled();
  });

  it('calls markAllKnown on the iframe doc when btn-mark-known is clicked', () => {
    const fakeDoc = document.createElement('div');
    getIframeDocument.mockReturnValue(fakeDoc);
    document.getElementById('btn-mark-known').click();
    expect(markAllKnown).toHaveBeenCalledWith(fakeDoc);
  });

  it('shows undo toast after marking words known', async () => {
    const fakeDoc = document.createElement('div');
    getIframeDocument.mockReturnValue(fakeDoc);
    markAllKnown.mockResolvedValue([{ word: 'hello', prev: 0 }]);

    document.getElementById('btn-mark-known').click();

    await vi.waitFor(() => {
      const toast = document.querySelector('.undo-toast');
      expect(toast).not.toBeNull();
      expect(toast.textContent).toContain('1 words as known');
      expect(toast.querySelector('.undo-btn')).not.toBeNull();
    });

    // Clean up the toast
    document.querySelector('.undo-toast')?.remove();
  });

  it('invokes restoreWordLevels when undo is clicked', async () => {
    const fakeDoc = document.createElement('div');
    getIframeDocument.mockReturnValue(fakeDoc);
    const prevState = [{ word: 'hello', prev: 0 }];
    markAllKnown.mockResolvedValue(prevState);

    document.getElementById('btn-mark-known').click();

    await vi.waitFor(() => {
      const toast = document.querySelector('.undo-toast');
      expect(toast).not.toBeNull();
    });

    const undoBtn = document.querySelector('.undo-btn');
    undoBtn.click();

    await vi.waitFor(() => {
      expect(restoreWordLevels).toHaveBeenCalledWith(fakeDoc, prevState);
    });
  });

  it('does not show undo toast when no words were marked', async () => {
    const fakeDoc = document.createElement('div');
    getIframeDocument.mockReturnValue(fakeDoc);
    markAllKnown.mockResolvedValue([]);

    document.getElementById('btn-mark-known').click();

    // Wait for the async chain to finish
    await new Promise(r => setTimeout(r, 50));

    const toast = document.querySelector('.undo-toast');
    expect(toast).toBeNull();
  });
});

// ── Subdomain: Export / Import ──────────────────────────────────────────

describe('Export / Import', () => {
  it('calls exportVocab and creates a download when btn-export is clicked', async () => {
    exportVocab.mockResolvedValue([{ word: 'test', level: 1 }]);

    // Mock URL.createObjectURL and revokeObjectURL
    const mockUrl = 'blob:test-url';
    const createObjectURL = vi.fn(() => mockUrl);
    const revokeObjectURL = vi.fn();
    globalThis.URL.createObjectURL = createObjectURL;
    globalThis.URL.revokeObjectURL = revokeObjectURL;

    // Mock the click on the dynamically created anchor
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    document.getElementById('btn-export').click();

    await vi.waitFor(() => {
      expect(exportVocab).toHaveBeenCalled();
      expect(createObjectURL).toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalled();
      expect(revokeObjectURL).toHaveBeenCalledWith(mockUrl);
    });

    clickSpy.mockRestore();
  });

  it('imports vocab data from a JSON file', async () => {
    const importInput = document.getElementById('import-input');
    const testData = [{ word: 'bonjour', level: 2 }];
    const mockFile = new File([JSON.stringify(testData)], 'vocab.json', { type: 'application/json' });

    // Simulate the file selection
    Object.defineProperty(importInput, 'files', {
      value: [mockFile],
      configurable: true,
    });

    importInput.dispatchEvent(new Event('change', { bubbles: true }));

    await vi.waitFor(() => {
      expect(importVocab).toHaveBeenCalledWith(testData);
    });
  });
});
