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
 * Parse Wiktionary REST API response.
 * Response shape: { "<lang>": [ { partOfSpeech, language, definitions: [{ definition }] } ] }
 * Definitions contain HTML which we strip.
 */
function parseWiktionary(data, lang) {
  if (!data || typeof data !== 'object') return null;

  // The response is keyed by language code. Try the requested language first,
  // then fall back to any available key.
  let sections = data[lang];
  if (!sections || !Array.isArray(sections)) {
    // Try all keys — the API sometimes uses different codes
    const keys = Object.keys(data);
    for (const k of keys) {
      if (Array.isArray(data[k]) && data[k].length > 0) {
        sections = data[k];
        break;
      }
    }
  }
  if (!sections || sections.length === 0) return null;

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

  return {
    word: '', // filled in by caller from the lookup word
    phonetic: '',
    definitions: defs.slice(0, 6),
  };
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
      defs.push({ partOfSpeech: m.partOfSpeech, definition: d.definition });
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
 * Look up a word. Returns { word, phonetic, definitions } or null.
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
  if (!provider) return null;

  const url = provider.buildUrl(language, word);

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const result = provider.parse(data, language);
    // Fill in word if parser didn't
    if (result && !result.word) result.word = word;
    return result;
  } catch {
    return null;
  }
}

async function fetchCustom(urlTemplate, language, word) {
  const url = urlTemplate
    .replace('{word}', encodeURIComponent(word))
    .replace('{lang}', language);

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return parseGeneric(word, data);
  } catch {
    return null;
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
