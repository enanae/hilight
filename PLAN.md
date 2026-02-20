# Vocabulary Browser — Implementation Plan

## Feature Summary

A slide-in panel that lets users browse all saved vocabulary for the current language, optionally
filtered to words that appear in the currently open book, with words grouped under shared stems.

---

## Architectural Decisions

### Decision 1: Where do word-family groups come from?

**Problem**: Neither dictionary API returns structured stem/family data.

- **Wiktionary REST API** (`/page/definition/`) returns only `partOfSpeech` + `definitions`.
  No etymology, derived terms, or related forms. The richer data (derived/related/synonyms)
  lives in Wiktionary dump files (wiktextract format) but not the live REST API.
- **Free Dictionary API** returns `synonyms`/`antonyms` arrays, but they're usually empty
  and don't represent morphological families ("running" → "run").
- **Wiktextract dumps** (kaikki.org) have full `derived`, `related`, `synonyms` fields, but
  they're multi-GB offline files — not viable for a client-side web app.

**Chosen approach: Client-side lightweight stemmer.**

A rule-based suffix-stripping stemmer for the 8 most common European languages
(en, es, fr, de, it, pt, nl, sv), falling back to identity (no grouping) for CJK, Arabic,
Thai, etc. where stemming is either inapplicable or requires full morphological analysis.

Why this over alternatives:
- Zero network requests, works offline
- ~150 lines of code, no external dependency
- Good enough for *grouping* (doesn't need to be linguistically perfect — "runs", "running",
  "runner" all reducing to "run" is sufficient even if "run" isn't the true lemma)
- Graceful degradation: for unsupported languages, words simply aren't grouped

We explicitly do NOT use a heavy NLP library (snowball-stemmer, natural.js, etc.) — the
bundle size tradeoff isn't justified for a grouping heuristic. If the stemmer produces a
bad group, the consequence is just a slightly odd visual cluster, not data corruption.

### Decision 2: How to get "words in this book"?

**Problem**: epub.js loads sections on demand into an iframe. There's no API to get all words
across all sections at once.

**Chosen approach: Lazy full-spine scan, cached per book.**

When the user first toggles the "In this book" filter:
1. Iterate `book.spine.items`
2. For each section, call `section.load(book.load.bind(book))` to get a Document
3. Walk text nodes, tokenize, collect normalized words into a `Set<string>`
4. Cache the Set in memory (keyed by book URL/identifier)

This is an async operation (~1–5s for a 300-page book). Show a progress bar during the scan.
After the first scan, filtering is instant.

Why not scan at book-open time:
- Delays initial render for no benefit (most users won't immediately open the vocab browser)
- Wastes work if the user never uses the filter

Why not only check the current section:
- "Words in this book" means the whole book, not the current page
- Users expect the filter to reflect the full text

### Decision 3: Panel vs Modal?

**Chosen: Right-side slide-in panel** (mirrors the TOC panel on the left).

- A modal blocks the reader — users may want to see context while browsing vocab
- A slide-in panel allows glancing at the book text alongside the word list
- On mobile (<600px), the panel goes full-width (same as TOC)
- Panel and TOC are mutually exclusive (opening one closes the other)

### Decision 4: Virtual scrolling?

**Chosen: No.** Use native DOM + CSS `overflow-y: auto`.

A vocabulary of 5,000 unique words produces ~5,000 DOM nodes. Modern browsers handle this
fine. Virtual scrolling adds significant complexity (intersection observers, dynamic heights
for groups, keyboard accessibility) for marginal performance gain. If a user somehow has
50,000+ words, the grouped/collapsed view keeps the visible DOM small anyway.

### Decision 5: Word grouping display

**Chosen: Collapsible stem groups, sorted by group size (largest first).**

```
▼ run (4 words)
   run ······ ✓ known
   running ·· ~ learning
   runner ···· ? unknown
   runs ······ ✓ known

▶ walk (2 words)         ← collapsed by default if > 20 groups visible
```

- The stem itself is the group header (may not be a real word — that's fine for grouping)
- Each word shows its current level with a colored badge
- Tapping a word opens inline options: cycle level, look up definition
- Single-word "groups" are shown flat (no collapsible header)

### Decision 6: Filter controls

Three filter axes, all combinable:

1. **Level filter**: All / Unknown / Learning / Known (radio buttons or segmented control)
2. **In-book filter**: toggle switch — "Only words in this book" (disabled when no book open)
3. **Search**: text input for quick find within the list

The level filter defaults to "All". The in-book filter defaults to off.

---

## Module Design

### New files

| File | Responsibility |
|------|----------------|
| `src/stemmer.js` | Lightweight multi-language stemmer (pure function, no deps) |
| `src/vocab-browser.js` | Panel UI: renders word list, handles filters, manages panel state |

### Modified files

| File | Changes |
|------|---------|
| `src/epub-reader.js` | Export `getAllBookWords()` — scans full spine, returns `Set<string>` |
| `src/main.js` | Add vocab browser button to toolbar, bind panel open/close, wire keyboard shortcut (`V`) |
| `src/style.css` | Vocab panel styles (mirrors `.toc-panel` structure) |
| `src/vocab-store.js` | Add `getAllWords(language)` — returns all entries (word + level) for a language |

### Data flow

```
User clicks "Vocab" button
  → vocab-browser.openPanel(language)
    → vocabStore.getAllWords(language)     // all saved words + levels
    → stemmer.stem(word, language)         // compute stem for each word
    → group words by stem
    → render grouped list

User toggles "In this book"
  → epub-reader.getAllBookWords()          // lazy scan, cached
    → intersect saved words with book words
    → re-render list

User taps a word
  → cycle level (same as reader tap)
  → update DOM in-place (badge color)
  → if reader is showing same word, update reader DOM too
```

---

## Implementation Steps

### Step 1: `stemmer.js` (~150 LOC)

```js
export function stem(word, language) → string
```

Language-specific suffix tables:

- **English**: -ing, -ed, -s, -es, -er, -est, -ly, -tion, -sion, -ment, -ness, -ful, -less, -able, -ible
- **Spanish**: -ando, -iendo, -ción, -mente, -ado, -ido, -ar, -er, -ir, -es, -os, -as
- **French**: -ment, -tion, -ant, -ent, -er, -ez, -ons, -ais, -ait, -aient
- **German**: -ung, -heit, -keit, -lich, -isch, -en, -er, -est, -te, -ten
- **Italian**: -mente, -zione, -ando, -endo, -ato, -ito, -are, -ere, -ire
- **Portuguese**: -ção, -mente, -ando, -endo, -ado, -ido
- **Dutch**: -en, -er, -heid, -ing, -lijk, -isch
- **Swedish**: -ning, -het, -lig, -isk, -ande, -ende, -ar, -er

Rules: strip longest matching suffix, but only if the remaining stem is ≥ 3 characters
(prevents "going" → "go" → "" or "be" → ""). Apply at most one rule per word.

For unlisted languages (ko, ja, zh, ar, ru, hi, th, vi, tr, pl): return the word unchanged.
This means those languages get a flat alphabetical list with no grouping — honest about
what we can't do rather than producing bad groups.

### Step 2: `vocab-store.js` addition

```js
/** Get all words + levels for a language. Returns [{word, level}, ...]. */
export async function getAllWords(language) {
  const store = await tx('readonly');
  const idx = store.index('by_language');
  const req = idx.getAll(language);
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result.map(r => ({ word: r.word, level: r.level })));
    req.onerror = () => reject(req.error);
  });
}
```

### Step 3: `epub-reader.js` — `getAllBookWords()`

```js
let cachedBookWords = null;
let cachedBookId = null;

export async function getAllBookWords(onProgress) {
  if (!currentBook) return null;
  const bookId = currentBook.key(); // unique book identifier
  if (cachedBookId === bookId && cachedBookWords) return cachedBookWords;

  const words = new Set();
  const items = currentBook.spine.items;
  for (let i = 0; i < items.length; i++) {
    const section = currentBook.spine.get(items[i].index);
    const doc = await section.load(currentBook.load.bind(currentBook));
    // Walk text nodes
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const segs = tokenize(walker.currentNode.textContent, langToLocale(currentLanguage));
      for (const seg of segs) {
        if (seg.isWord) words.add(normalizeWord(seg.text, langToLocale(currentLanguage)));
      }
    }
    section.unload();
    if (onProgress) onProgress((i + 1) / items.length);
  }

  cachedBookWords = words;
  cachedBookId = bookId;
  return words;
}
```

### Step 4: `vocab-browser.js` (~250 LOC)

**Panel structure:**

```html
<div class="vocab-panel">
  <div class="vocab-header">
    <h3>Vocabulary</h3>
    <button class="close-btn">✕</button>
  </div>
  <div class="vocab-filters">
    <input type="search" placeholder="Search words..." />
    <div class="vocab-level-filter">
      <button class="active">All</button>
      <button>?</button>     <!-- unknown -->
      <button>~</button>     <!-- learning -->
      <button>✓</button>     <!-- known -->
    </div>
    <label class="vocab-book-filter">
      <input type="checkbox" /> In this book
      <span class="scan-progress"></span>   <!-- shows during spine scan -->
    </label>
  </div>
  <div class="vocab-list">
    <!-- rendered groups -->
  </div>
  <div class="vocab-summary">
    42 words shown · 3 groups
  </div>
</div>
```

**Core rendering logic:**

```js
function renderList(words, bookWords, searchQuery, levelFilter) {
  // 1. Filter by level
  let filtered = levelFilter === 'all' ? words : words.filter(w => w.level === levelFilter);

  // 2. Filter by book presence
  if (bookWords) filtered = filtered.filter(w => bookWords.has(w.word));

  // 3. Filter by search
  if (searchQuery) filtered = filtered.filter(w => w.word.includes(searchQuery));

  // 4. Group by stem
  const groups = new Map();
  for (const w of filtered) {
    const s = stem(w.word, currentLanguage);
    if (!groups.has(s)) groups.set(s, []);
    groups.get(s).push(w);
  }

  // 5. Sort groups by size (largest first), words within group alphabetically
  const sorted = [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length);

  // 6. Render
  ...
}
```

**Word interaction in the panel:**

- Click a word → cycle its level (same as in-reader tap)
- The in-reader spans update too (query by `data-word` in iframe doc)
- Long-press / right-click → show definition popup (reuse existing `showWordDefinition`)

### Step 5: `main.js` integration

- Add `📚` button to reader toolbar (between "✓ All known" and "✕")
- `V` keyboard shortcut to toggle the vocab panel
- Opening vocab panel closes TOC panel (and vice versa)
- Panel reads `currentLanguage` from main.js state

### Step 6: `style.css` — vocab panel styles

Mirror `.toc-panel` but on the right side. Key additions:

```css
.vocab-panel {
  position: absolute;
  top: 0;
  right: 0;               /* right side, mirroring TOC on left */
  width: 340px;
  height: 100%;
  background: var(--surface);
  border-left: 1px solid var(--border);
  box-shadow: -4px 0 24px rgba(0,0,0,0.4);
  z-index: 100;
  display: none;
  flex-direction: column;
}

.vocab-panel.open { display: flex; }

/* Mobile: full width */
@media (max-width: 600px) {
  .vocab-panel { width: 100%; }
}

.vocab-group-header {
  /* collapsible, shows stem + word count */
}

.vocab-word-row {
  /* word text + level badge, min-height 40px for touch */
}

.vocab-level-badge {
  /* colored dot matching hl-unknown/partial/known colors */
}

.vocab-scan-bar {
  /* thin progress bar during book scan */
}
```

---

## Edge Cases & Mitigations

| Edge case | Mitigation |
|-----------|------------|
| User has 0 saved words | Show empty state: "No vocabulary saved yet. Tap words while reading to start building your list." |
| Book scan fails mid-way (corrupt section) | try-catch per section, skip failures, still return partial set |
| Stemmer produces a 1-char stem | Floor stem length at 3 chars; if strip would go below, don't strip |
| Two unrelated words share a stem | Acceptable — the grouping is a convenience, not a linguistic claim. Users see the actual words inside each group. |
| User changes language while panel is open | Re-fetch words for the new language, re-render. Clear book word cache (different tokenization). |
| Panel open + chapter navigation | Stats update in panel too (word levels might change). Listen for the same `onStatsUpdate` callback. |

---

## What This Plan Does NOT Do

- **No server-side lemmatization**: Would give better grouping but requires a backend
- **No Wiktextract integration**: The dump data is comprehensive but multi-GB, not suitable for client-side
- **No spaced-repetition**: The vocab browser is read-only browsing, not a flashcard system
- **No export-from-panel**: Use the existing export button (exports all vocab for the language)

These are natural follow-ups but each is a separate feature with its own architectural decisions.
