/**
 * Dictionary API integration.
 * Supports pluggable dictionary APIs per language.
 *
 * Built-in support:
 * - Free Dictionary API: https://dictionaryapi.dev/
 *   Works well for English, partial support for other languages.
 * - Custom URL template: user provides a URL with {word} placeholder
 */

const SETTINGS_KEY = 'hilight-dict-settings';

/** Parse response from dictionaryapi.dev (same format for all languages). */
function parseDictApiDev(data) {
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

/** Built-in dictionary API configs for all supported languages. */
const BUILTIN_APIS = {};
for (const code of ['en', 'es', 'fr', 'de', 'it', 'pt', 'ko', 'ja', 'zh', 'ar', 'ru', 'hi', 'th', 'vi', 'tr', 'pl', 'nl', 'sv']) {
  BUILTIN_APIS[code] = {
    name: 'Free Dictionary API',
    urlTemplate: `https://api.dictionaryapi.dev/api/v2/entries/${code}/{word}`,
    parse: parseDictApiDev,
  };
}

/** Load saved dictionary settings from localStorage. */
export function loadDictSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  } catch {
    return {};
  }
}

/** Save dictionary settings. Settings is { [language]: { urlTemplate, name } }. */
export function saveDictSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

/**
 * Look up a word. Returns { word, phonetic, definitions } or null.
 */
export async function lookupWord(language, word) {
  const config = getConfig(language);
  if (!config) return null;

  const url = config.urlTemplate.replace('{word}', encodeURIComponent(word));

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();

    if (config.parse) {
      return config.parse(data);
    }

    // For custom APIs, try a generic parse: look for common fields
    return parseGeneric(word, data);
  } catch {
    return null;
  }
}

function getConfig(language) {
  const custom = loadDictSettings();
  if (custom[language]) return custom[language];
  if (BUILTIN_APIS[language]) return BUILTIN_APIS[language];
  return null;
}

function parseGeneric(word, data) {
  // Handle array responses
  const entry = Array.isArray(data) ? data[0] : data;
  if (!entry) return null;

  const definitions = [];

  // Try common response shapes
  if (entry.meanings) {
    for (const m of entry.meanings) {
      for (const d of (m.definitions || []).slice(0, 2)) {
        definitions.push({ partOfSpeech: m.partOfSpeech || '', definition: d.definition || d.text || '' });
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

/** Check if a dictionary is configured for a language. */
export function hasDictionary(language) {
  return !!getConfig(language);
}
