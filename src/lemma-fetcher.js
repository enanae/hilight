/**
 * Batch Wiktionary lemma resolver.
 *
 * Fetches canonical lemma forms for a list of words by querying the
 * Wiktionary REST API. Uses concurrency limiting to avoid overwhelming
 * the API and AbortSignal for cancellation.
 *
 * Results:
 * - string lemma → the canonical form (e.g., "go" for "went")
 * - word itself → the word IS the lemma (no form-of link found)
 * - null → word not in Wiktionary (prevents re-fetch on next open)
 */
import { PROVIDERS, extractStemWord } from './dictionary.js';

const MAX_CONCURRENT = 5;

/**
 * Fetch lemmas for a batch of words.
 * @param {string} language - language code
 * @param {string[]} words - words to look up
 * @param {Object} [options]
 * @param {AbortSignal} [options.signal] - abort signal for cancellation
 * @param {function} [options.onProgress] - called with (completed, total)
 * @returns {Promise<Map<string, string|null>>} word → lemma mapping
 */
export async function fetchLemmas(language, words, { signal, onProgress } = {}) {
  const results = new Map();
  if (words.length === 0) return results;

  let completed = 0;
  let active = 0;
  let idx = 0;

  return new Promise((resolve) => {
    function next() {
      // Check cancellation
      if (signal?.aborted) {
        resolve(results);
        return;
      }

      // All done?
      if (completed >= words.length) {
        resolve(results);
        return;
      }

      // Launch workers up to concurrency limit
      while (active < MAX_CONCURRENT && idx < words.length) {
        const word = words[idx++];
        active++;
        fetchOneLemma(language, word, signal)
          .then((lemma) => {
            results.set(word, lemma);
          })
          .catch(() => {
            results.set(word, null);
          })
          .finally(() => {
            active--;
            completed++;
            if (onProgress) onProgress(completed, words.length);
            next();
          });
      }
    }
    next();
  });
}

/**
 * Fetch the lemma for a single word from Wiktionary.
 * @returns {Promise<string|null>} lemma, word itself, or null
 */
async function fetchOneLemma(language, word, signal) {
  const url = PROVIDERS.wiktionary.buildUrl(language, word);

  const res = await fetch(url, { signal });
  if (!res.ok) return null;

  const data = await res.json();

  // Use same language fallback chain as parseWiktionary:
  // try defLang → lang → 'other' → any key
  let sections = null;
  for (const tryLang of [language, 'other']) {
    if (tryLang && Array.isArray(data[tryLang]) && data[tryLang].length > 0) {
      sections = data[tryLang];
      break;
    }
  }
  if (!sections) {
    for (const k of Object.keys(data)) {
      if (Array.isArray(data[k]) && data[k].length > 0) {
        sections = data[k];
        break;
      }
    }
  }
  if (!sections || sections.length === 0) return null;

  // Check first definition for form-of link
  for (const section of sections) {
    for (const d of (section.definitions || [])) {
      if (!d.definition) continue;
      const stem = extractStemWord(d.definition);
      if (stem) return stem; // found lemma
      // Has a real definition (not form-of) → word IS the lemma
      return word;
    }
  }

  return word; // fallback: treat as its own lemma
}
