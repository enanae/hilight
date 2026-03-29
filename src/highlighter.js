/**
 * Highlighter: processes text content inside a container element,
 * wrapping each word in a clickable span with vocab-level styling.
 *
 * This module is PURELY about DOM manipulation — no event handlers.
 * Event handling is done in epub-reader.js via epubjs's rendition events.
 */
import { tokenize, normalizeWord, langToLocale } from './tokenizer.js';
import { getLevel, setLevel, getLevels } from './vocab-store.js';
import { lookupWord, hasDictionary } from './dictionary.js';
import { state } from './app-state.js';
import { escapeHtml } from './ui-utils.js';

/** Level constants */
export const LEVEL_UNKNOWN = 0;
export const LEVEL_PARTIAL = 1;
export const LEVEL_KNOWN = 2;

const LEVEL_CLASSES = ['hl-unknown', 'hl-partial', 'hl-known'];

/** Getter for popup state — called by epub-reader and main to suppress interactions. */
export function isPopupActive() {
  return state.popupActive;
}

/** Reset popup state. Call when iframe content is replaced (chapter nav). */
export function resetPopupState() {
  state.popupActive = false;
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

    // Guard: if a concurrent setLanguage() already replaced this text node,
    // it will have been removed from the DOM (parentNode === null). Skip it.
    if (!node.parentNode) continue;
    node.parentNode.replaceChild(frag, node);
  }

  if (onStatsUpdate) onStatsUpdate();
}

/**
 * Mark all unknown/partial words on the page as known (level 2).
 * Used by the "Mark page as known" toolbar button.
 * Returns previous state for undo: [{language, word, level}, ...]
 */
export async function markAllKnown(doc) {
  const spans = doc.querySelectorAll('.hl-word:not(.hl-known)');
  const updates = [];
  const seen = new Set();
  const previousState = [];
  for (const span of spans) {
    const word = span.dataset.word;
    const language = span.dataset.language;
    const prevLevel = parseInt(span.dataset.level, 10);
    const key = `${language}:${word}`;
    if (!seen.has(key)) {
      seen.add(key);
      previousState.push({ language, word, level: prevLevel });
      updates.push(setLevel(language, word, LEVEL_KNOWN));
    }
    span.dataset.level = LEVEL_KNOWN;
    span.className = `hl-word ${LEVEL_CLASSES[LEVEL_KNOWN]}`;
  }
  await Promise.all(updates);
  return previousState;
}

/**
 * Restore word levels from a previous state snapshot.
 * Used by undo after markAllKnown.
 */
export async function restoreWordLevels(doc, previousState) {
  const updates = [];
  for (const { language, word, level } of previousState) {
    updates.push(setLevel(language, word, level));
    doc.querySelectorAll(`.hl-word[data-word="${CSS.escape(word)}"][data-language="${CSS.escape(language)}"]`)
      .forEach(el => {
        el.dataset.level = level;
        el.className = `hl-word ${LEVEL_CLASSES[level]}`;
      });
  }
  await Promise.all(updates);
}

/**
 * Handle a short tap on a word span — just cycle the knowledge state.
 * Called from epub-reader.js via rendition events.
 */
export async function handleWordTap(span, onStatsUpdate) {
  const level = (parseInt(span.dataset.level, 10) + 1) % 3;
  await setWordLevel(span, level, onStatsUpdate);
}

/**
 * Set a specific knowledge level on a word span.
 * Updates the DB and ALL matching spans in the document.
 * Used by review mode (direct grading) and handleWordTap (cycling).
 */
export async function setWordLevel(span, level, onStatsUpdate) {
  const doc = span.ownerDocument;
  const word = span.dataset.word;
  const language = span.dataset.language;

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
  popup.innerHTML = '<button class="hl-popup-close" aria-label="Close">\u2715</button><div class="hl-popup-loading">Looking up...</div>';

  state.popupActive = true;

  doc.body.appendChild(popup);
  positionPopup(popup, anchor, doc);

  const result = await lookupWord(language, word);

  if (!result || result.error || !result.definitions || result.definitions.length === 0) {
    const isOffline = result?.error === 'offline';
    const msg = isOffline
      ? `Could not connect. Check your internet connection.`
      : `No definition found for "<strong>${escapeHtml(word)}</strong>"`;
    popup.innerHTML = `<div class="hl-popup-empty">${msg}</div>`;
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
    // Show stem word definitions when this is an inflected form
    if (result.stemWord && result.stemDefinitions?.length > 0) {
      html += `<div class="hl-popup-word" style="margin-top:8px;padding-top:8px;border-top:1px solid #2a2a3a">${escapeHtml(result.stemWord)}`;
      html += '</div><ul class="hl-popup-defs">';
      for (const d of result.stemDefinitions) {
        html += '<li>';
        if (d.partOfSpeech) html += `<em>${escapeHtml(d.partOfSpeech)}</em> `;
        html += escapeHtml(d.definition);
        html += '</li>';
      }
      html += '</ul>';
    }
    popup.innerHTML = html;
  }

  positionPopup(popup, anchor, doc);

  // Dismiss popup on any NEW interaction. We gate on a timestamp so that
  // the synthetic click/touchstart from the same long-press gesture that
  // opened the popup doesn't immediately close it (~400ms window).
  //
  // IMPORTANT: Do NOT call preventDefault/stopPropagation here — that
  // blocks all touch event propagation including scroll gestures.
  // Instead, defer setting state.popupActive=false so word-tap handlers
  // (which check state.popupActive) ignore this same event cycle.
  const showTime = Date.now();
  const DISMISS_GUARD_MS = 400;
  const closePopup = () => {
    popup.remove();
    doc.removeEventListener('click', dismiss, true);
    doc.removeEventListener('touchstart', dismiss, true);
    setTimeout(() => { state.popupActive = false; }, 0);
  };
  const dismiss = (e) => {
    if (Date.now() - showTime < DISMISS_GUARD_MS) return;
    // Close button always works
    if (e.target.closest('.hl-popup-close')) {
      closePopup();
      return;
    }
    // If the tap is inside the popup itself, ignore it (allow link clicks etc.)
    if (popup.contains(e.target)) return;
    closePopup();
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

