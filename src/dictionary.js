/**
 * Dictionary API integration with multiple providers.
 *
 * Built-in providers:
 * - Wiktionary REST API (free, excellent multi-language coverage)
 * - Free Dictionary API v2 (dictionaryapi.dev, English only)
 * - Custom URL template (user provides a URL with {word} placeholder)
 *
 * Each language has a default provider. Users can override per-language
 * via the settings modal (choose a provider or supply a custom URL).
 */

const SETTINGS_KEY = 'hilight-dict-settings';

// ─── Providers ────────────────────────────────────────────────────────

/**
 * Registry of built-in dictionary providers.
 * Each provider has: name, buildUrl(lang, word), parse(data, lang).
 */
export const PROVIDERS = {
  wiktionary: {
    id: 'wiktionary',
    name: 'Wiktionary',
    description: 'Free, excellent coverage for all languages',
    // The definition endpoint only exists on en.wiktionary.org,
    // but it returns entries for words in all languages, keyed by lang code.
    buildUrl: (_lang, word) =>
      `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`,
    parse: parseWiktionary,
  },

  'free-dict': {
    id: 'free-dict',
    name: 'Free Dictionary API',
    description: 'Good for English; limited other-language support',
    buildUrl: (lang, word) =>
      `https://api.dictionaryapi.dev/api/v2/entries/${lang}/${encodeURIComponent(word)}`,
    parse: parseFreeDictV2,
  },
};

/** Default provider per language. */
const DEFAULT_PROVIDER = {
  en: 'free-dict',
  // Everything else falls back to wiktionary
};

function getDefaultProviderId(lang) {
  return DEFAULT_PROVIDER[lang] || 'wiktionary';
}

// ─── Parsers ──────────────────────────────────────────────────────────

/** Strip HTML tags from a string. */
function stripHtml(html) {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, '').trim();
}

/**
 * Extract a stem/lemma word from a Wiktionary "form-of" definition.
 * These definitions look like: "third-person plural future indicative of <a>desaparecer</a>"
 * Returns the stem word if found, null otherwise.
 */
function extractStemWord(definitionHtml) {
  if (!definitionHtml) return null;
  // Look for the pattern: form-of-definition-link containing an <a> tag with the stem word
  const match = definitionHtml.match(/form-of-definition-link[^>]*>.*?<a[^>]*>([^<]+)<\/a>/);
  return match ? match[1].trim() : null;
}

/**
 * Check if the primary definition is a "form-of" reference (inflected form).
 * Looks at the first definition across all sections — if it references a
 * stem/lemma word, returns that word. This handles conjugated verbs
 * ("third-person plural future of desaparecer"), plural nouns
 * ("plural of libro"), and other inflections.
 */
function findStemWord(sections) {
  if (!sections || sections.length === 0) return null;
  for (const section of sections) {
    for (const d of (section.definitions || [])) {
      if (!d.definition) continue;
      return extractStemWord(d.definition);
    }
  }
  return null;
}

/**
 * Parse Wiktionary REST API response.
 * Response shape: { "<lang>": [ { partOfSpeech, language, definitions: [{ definition }] } ] }
 * Definitions contain HTML which we strip.
 *
 * If all definitions are "form-of" references (e.g. "plural of X",
 * "third-person future of Y"), sets result.stemWord so the caller
 * can auto-fetch the stem word's definition too.
 */
function parseWiktionary(data, lang, defLang) {
  if (!data || typeof data !== 'object') return null;

  // The response is keyed by language code. Priority:
  // 1. Try the definition language (user's native language) for bilingual use
  // 2. Try the book language
  // 3. Try "other" (Wiktionary groups Norwegian Bokmål/Nynorsk and some
  //    other languages under this key)
  // 4. Fall back to any available key
  let sections = null;
  for (const tryLang of [defLang, lang, 'other']) {
    if (tryLang && Array.isArray(data[tryLang]) && data[tryLang].length > 0) {
      sections = data[tryLang];
      break;
    }
  }
  if (!sections) {
    const keys = Object.keys(data);
    for (const k of keys) {
      if (Array.isArray(data[k]) && data[k].length > 0) {
        sections = data[k];
        break;
      }
    }
  }
  if (!sections || sections.length === 0) return null;

  // Check if this is a "form-of" entry before stripping HTML
  const stemWord = findStemWord(sections);

  const defs = [];
  for (const section of sections) {
    const pos = section.partOfSpeech || '';
    for (const d of (section.definitions || []).slice(0, 3)) {
      const text = stripHtml(d.definition);
      if (text) {
        defs.push({ partOfSpeech: pos, definition: text });
      }
    }
  }
  if (defs.length === 0) return null;

  const result = {
    word: '', // filled in by caller from the lookup word
    phonetic: '',
    definitions: defs.slice(0, 6),
  };
  if (stemWord) result.stemWord = stemWord;
  return result;
}

/**
 * Parse Free Dictionary API v2 response.
 * v2 uses "meanings" array with partOfSpeech + definitions array.
 */
function parseFreeDictV2(data) {
  if (!Array.isArray(data) || data.length === 0) return null;
  const entry = data[0];
  const meanings = entry.meanings || [];
  const defs = [];
  for (const m of meanings) {
    for (const d of (m.definitions || []).slice(0, 2)) {
      if (d.definition) {
        defs.push({ partOfSpeech: m.partOfSpeech || '', definition: d.definition });
      }
    }
  }
  if (defs.length === 0) return null;
  return {
    word: entry.word,
    phonetic: entry.phonetic || '',
    definitions: defs,
  };
}

/**
 * Generic parser for custom API responses.
 * Tries common JSON shapes: v2-style (meanings), v1-style (meaning), flat definitions array.
 */
function parseGeneric(word, data) {
  const entry = Array.isArray(data) ? data[0] : data;
  if (!entry) return null;

  const definitions = [];

  if (entry.meanings) {
    for (const m of entry.meanings) {
      for (const d of (m.definitions || []).slice(0, 2)) {
        definitions.push({ partOfSpeech: m.partOfSpeech || '', definition: d.definition || d.text || '' });
      }
    }
  } else if (entry.meaning && typeof entry.meaning === 'object') {
    for (const [pos, defList] of Object.entries(entry.meaning)) {
      if (!Array.isArray(defList)) continue;
      for (const d of defList.slice(0, 2)) {
        definitions.push({ partOfSpeech: pos, definition: d.definition || '' });
      }
    }
  } else if (entry.definitions) {
    for (const d of entry.definitions.slice(0, 4)) {
      definitions.push({ partOfSpeech: d.partOfSpeech || '', definition: d.definition || d.text || '' });
    }
  } else if (entry.definition) {
    definitions.push({ partOfSpeech: '', definition: entry.definition });
  } else if (typeof entry === 'string') {
    definitions.push({ partOfSpeech: '', definition: entry });
  }

  return {
    word: entry.word || word,
    phonetic: entry.phonetic || entry.pronunciation || '',
    definitions,
  };
}

// ─── Settings persistence ─────────────────────────────────────────────

/**
 * Load saved dictionary settings from localStorage.
 * Shape: { [languageCode]: { provider: string, urlTemplate?: string, name?: string } }
 */
export function loadDictSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  } catch {
    return {};
  }
}

/** Save dictionary settings. */
export function saveDictSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Get the active provider ID for a language (user override or default).
 */
export function getActiveProviderId(language) {
  const settings = loadDictSettings();
  const saved = settings[language];
  if (saved?.provider) return saved.provider;
  return getDefaultProviderId(language);
}

/**
 * Get the list of provider IDs available for a language.
 */
export function getProviderChoices() {
  return Object.values(PROVIDERS);
}

/**
 * Get the user's chosen definition language (for bilingual lookup).
 * Falls back to the book language if not set.
 */
function getDefLanguage(bookLanguage) {
  return localStorage.getItem('hilight-def-lang') || bookLanguage;
}

/**
 * Look up a word.
 * Returns { word, phonetic, definitions } on success,
 * or { error: 'offline' | 'not-found' } on failure.
 *
 * Uses the user's "definition language" preference to select which
 * language's entries to return from multilingual providers like Wiktionary.
 */
export async function lookupWord(language, word) {
  const settings = loadDictSettings();
  const saved = settings[language];

  // Custom URL override (also handles old settings format with urlTemplate but no provider)
  if (saved?.urlTemplate && (saved.provider === 'custom' || !saved.provider)) {
    return fetchCustom(saved.urlTemplate, language, word);
  }

  // Built-in provider
  const providerId = saved?.provider || getDefaultProviderId(language);
  const provider = PROVIDERS[providerId];
  if (!provider) return { error: 'not-found' };

  const url = provider.buildUrl(language, word);

  try {
    const res = await fetch(url);
    if (!res.ok) return { error: 'not-found' };
    const data = await res.json();
    const dl = getDefLanguage(language);
    const result = provider.parse(data, language, dl);
    // Fill in word if parser didn't
    if (result && !result.word) result.word = word;
    if (!result) return { error: 'not-found' };

    // Auto-fetch stem word definition when the result is a "form-of" entry
    // (e.g. "third-person plural future of desaparecer" → also fetch "desaparecer")
    if (result.stemWord && result.stemWord !== word) {
      try {
        const stemUrl = provider.buildUrl(language, result.stemWord);
        const stemRes = await fetch(stemUrl);
        if (stemRes.ok) {
          const stemData = await stemRes.json();
          const stemResult = provider.parse(stemData, language, dl);
          if (stemResult && stemResult.definitions?.length > 0) {
            result.stemDefinitions = stemResult.definitions;
          }
        }
      } catch { /* stem lookup is best-effort */ }
    }

    return result;
  } catch (err) {
    // Network errors (offline, DNS failure, CORS, timeout)
    if (err instanceof TypeError) return { error: 'offline' };
    return { error: 'not-found' };
  }
}

async function fetchCustom(urlTemplate, language, word) {
  const url = urlTemplate
    .replace('{word}', encodeURIComponent(word))
    .replace('{lang}', language);

  try {
    const res = await fetch(url);
    if (!res.ok) return { error: 'not-found' };
    const data = await res.json();
    return parseGeneric(word, data) || { error: 'not-found' };
  } catch (err) {
    if (err instanceof TypeError) return { error: 'offline' };
    return { error: 'not-found' };
  }
}

/** Check if a dictionary is configured for a language. */
export function hasDictionary(language) {
  const settings = loadDictSettings();
  const saved = settings[language];
  if (saved?.urlTemplate && (saved.provider === 'custom' || !saved.provider)) return true;
  const providerId = saved?.provider || getDefaultProviderId(language);
  return !!PROVIDERS[providerId];
}
