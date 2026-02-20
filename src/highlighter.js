/**
 * Highlighter: processes text content inside a container element,
 * wrapping each word in a clickable span with vocab-level styling.
 *
 * This module is PURELY about DOM manipulation — no event handlers.
 * Event handling is done in epub-reader.js via epubjs's rendition events.
 */
import { tokenize, normalizeWord } from './tokenizer.js';
import { getLevel, setLevel, getLevels } from './vocab-store.js';
import { lookupWord, hasDictionary } from './dictionary.js';

/** Level constants */
export const LEVEL_UNKNOWN = 0;
export const LEVEL_PARTIAL = 1;
export const LEVEL_KNOWN = 2;

const LEVEL_CLASSES = ['hl-unknown', 'hl-partial', 'hl-known'];

/** True when a definition popup is visible — all other interactions should be suppressed. */
export let popupActive = false;

/** Reset popup state. Call when iframe content is replaced (chapter nav). */
export function resetPopupState() {
  popupActive = false;
}

/**
 * Highlight all words in a container element.
 * Walks the DOM, finds text nodes, replaces them with word spans.
 */
export async function highlightContainer(container, language, { onStatsUpdate } = {}) {
  const locale = langToLocale(language);
  const doc = container.ownerDocument;

  // Collect all text nodes
  const textNodes = [];
  const walker = doc.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    if (walker.currentNode.textContent.trim()) {
      textNodes.push(walker.currentNode);
    }
  }

  // Gather all unique words for a bulk lookup
  const allWords = new Set();
  const nodeSegments = [];
  for (const node of textNodes) {
    const segs = tokenize(node.textContent, locale);
    nodeSegments.push(segs);
    for (const seg of segs) {
      if (seg.isWord) allWords.add(normalizeWord(seg.text, locale));
    }
  }

  // Bulk fetch levels
  const levels = await getLevels(language, [...allWords]);

  // Replace each text node with spans
  for (let i = 0; i < textNodes.length; i++) {
    const node = textNodes[i];
    const segs = nodeSegments[i];
    const frag = doc.createDocumentFragment();

    for (const seg of segs) {
      if (!seg.isWord) {
        frag.appendChild(doc.createTextNode(seg.text));
        continue;
      }

      const norm = normalizeWord(seg.text, locale);
      const level = levels.get(norm) || 0;
      const span = doc.createElement('span');
      span.textContent = seg.text;
      span.className = `hl-word ${LEVEL_CLASSES[level]}`;
      span.dataset.word = norm;
      span.dataset.level = level;
      span.dataset.language = language;

      frag.appendChild(span);
    }

    node.parentNode.replaceChild(frag, node);
  }

  if (onStatsUpdate) onStatsUpdate();
}

/**
 * Handle a short tap on a word span — just cycle the knowledge state.
 * Called from epub-reader.js via rendition events.
 */
export async function handleWordTap(span, onStatsUpdate) {
  const doc = span.ownerDocument;
  const word = span.dataset.word;
  const language = span.dataset.language;
  let level = parseInt(span.dataset.level, 10);

  // Cycle: unknown(0) -> partial(1) -> known(2) -> unknown(0)
  level = (level + 1) % 3;

  await setLevel(language, word, level);

  // Update ALL spans for this word in the document
  doc.querySelectorAll(`.hl-word[data-word="${CSS.escape(word)}"][data-language="${CSS.escape(language)}"]`)
    .forEach(el => {
      el.dataset.level = level;
      el.className = `hl-word ${LEVEL_CLASSES[level]}`;
    });

  if (onStatsUpdate) onStatsUpdate();
}

/**
 * Handle a long press on a word span — show the dictionary definition.
 * Called from epub-reader.js via rendition events.
 */
export function showWordDefinition(span) {
  const word = span.dataset.word;
  const language = span.dataset.language;
  if (hasDictionary(language)) {
    showDefinition(span, language, word);
  }
}

async function showDefinition(anchor, language, word) {
  const doc = anchor.ownerDocument;

  // Remove any existing popup
  doc.querySelectorAll('.hl-popup').forEach(el => el.remove());

  const popup = doc.createElement('div');
  popup.className = 'hl-popup';
  popup.innerHTML = '<div class="hl-popup-loading">Looking up...</div>';

  popupActive = true;

  doc.body.appendChild(popup);
  positionPopup(popup, anchor, doc);

  const result = await lookupWord(language, word);

  if (!result || result.definitions.length === 0) {
    popup.innerHTML = `<div class="hl-popup-empty">No definition found for "<strong>${escapeHtml(word)}</strong>"</div>`;
  } else {
    let html = `<div class="hl-popup-word">${escapeHtml(result.word)}`;
    if (result.phonetic) html += ` <span class="hl-popup-phonetic">${escapeHtml(result.phonetic)}</span>`;
    html += '</div><ul class="hl-popup-defs">';
    for (const d of result.definitions) {
      html += '<li>';
      if (d.partOfSpeech) html += `<em>${escapeHtml(d.partOfSpeech)}</em> `;
      html += escapeHtml(d.definition);
      html += '</li>';
    }
    html += '</ul>';
    popup.innerHTML = html;
  }

  positionPopup(popup, anchor, doc);

  // Dismiss popup on any NEW interaction. We gate on a timestamp so that
  // the synthetic click/touchstart from the same long-press gesture that
  // opened the popup doesn't immediately close it (~300ms window).
  const showTime = Date.now();
  const DISMISS_GUARD_MS = 400;
  const dismiss = (e) => {
    if (Date.now() - showTime < DISMISS_GUARD_MS) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    popup.remove();
    popupActive = false;
    doc.removeEventListener('click', dismiss, true);
    doc.removeEventListener('touchstart', dismiss, true);
  };
  doc.addEventListener('click', dismiss, true);
  doc.addEventListener('touchstart', dismiss, true);
}

function positionPopup(popup, anchor, doc) {
  const win = doc.defaultView;
  const rect = anchor.getBoundingClientRect();
  popup.style.position = 'fixed';
  popup.style.left = `${rect.left}px`;
  popup.style.top = `${rect.bottom + 4}px`;

  requestAnimationFrame(() => {
    const pr = popup.getBoundingClientRect();
    if (pr.right > win.innerWidth - 10) {
      popup.style.left = `${Math.max(10, win.innerWidth - pr.width - 10)}px`;
    }
    if (pr.left < 10) {
      popup.style.left = '10px';
    }
    if (pr.bottom > win.innerHeight - 10) {
      popup.style.top = `${rect.top - pr.height - 4}px`;
    }
  });
}

function escapeHtml(str) {
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

function langToLocale(lang) {
  const map = {
    en: 'en', es: 'es', fr: 'fr', de: 'de', it: 'it', pt: 'pt',
    ko: 'ko', ja: 'ja', zh: 'zh', ar: 'ar', ru: 'ru', hi: 'hi',
    th: 'th', vi: 'vi', tr: 'tr', pl: 'pl', nl: 'nl', sv: 'sv',
  };
  return map[lang] || lang;
}
