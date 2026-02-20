# Hilight — Full Repo Audit & Restructure Plan

## Executive Summary

The audit found **50+ issues** across 7 source files. Most are not isolated bugs — they stem
from three architectural problems:

1. **No event coordination layer** — touch, click, popup dismiss, and page navigation all
   mutate shared state (`popupActive`, `lastActionTime`) with no central coordinator. Race
   conditions are inevitable.
2. **No lifecycle management** — epub.js resources (renditions, iframes, event listeners) are
   never properly cleaned up. State flags like `popupActive` survive across chapter/book
   transitions and get permanently stuck.
3. **Tight coupling between rendering, events, and data** — highlighter.js owns popup DOM,
   dismiss logic, AND the `popupActive` flag. epub-reader.js owns touch logic AND scroll/nav.
   main.js owns UI AND settings AND stats. No module has a clean single responsibility.

The plan below is ordered by **user-facing impact**, not by file. Each phase is independently
shippable.

---

## Phase 1: Fix the broken interactions (critical UX bugs)

These are the bugs users hit every session. Fix them first.

### 1A. Fix popup dismissed immediately by phantom `click` event

**Bug**: On mobile, a long-press fires: touchstart → (hold) → touchend → **click**. The dismiss
handler (`highlighter.js:171`) listens for `click` in capture phase. The synthetic `click` from
lifting after the long press fires ~50ms after touchend and immediately dismisses the popup.
This is why "long click doesn't work correctly after short click" — the popup flashes and vanishes.

**Fix**: Track the creation timestamp. In the dismiss handler, ignore events within 400ms of
popup creation (synthetic events from the originating gesture always arrive within ~300ms).
Remove the fragile 50ms `setTimeout` and replace with timestamp gating.

**Files**: `highlighter.js` lines 155–173

### 1B. Fix `popupActive` stuck forever after chapter navigation

**Bug**: If the user navigates (next/prev/TOC) while a popup is showing, the iframe is destroyed.
The popup DOM and dismiss listeners vanish, but `popupActive` stays `true` forever. ALL
interactions are suppressed — taps, keyboard nav, page buttons — until page reload.

**Fix**: Reset `popupActive = false` in the epub-reader content hook (when a new chapter loads).
Also wrap `showDefinition` in try/finally so `popupActive` is always cleaned up even if
`lookupWord` throws.

**Files**: `highlighter.js` lines 120–173, `epub-reader.js` line 63

### 1C. Fix touch+click double-firing cycling words twice

**Bug**: On mobile, a short tap fires both `touchend` and then `click`. The 300ms debounce
(`DEBOUNCE_MS`) sometimes fails because the `click` arrives right at the boundary. The word
cycles twice in one tap (unknown → learning → known).

**Fix**: Set `lastActionTime` in both handlers, AND add a flag that suppresses `click` events
after any `touchend` was processed for the same gesture. Or: don't register the `click` handler
on touch-capable devices at all (use it only for mouse input).

**Files**: `epub-reader.js` lines 145–176

### 1D. Fix `stat-unknown` always showing 0

**Bug**: `main.js:263` does `document.querySelectorAll('.hl-word.hl-unknown')` on the parent
document, but highlighted words live inside the epub iframe. Query always returns 0.

**Fix**: After highlighting, emit the unknown-on-page count from the content hook inside the
iframe, or query the iframe document directly via `currentRendition`.

**Files**: `main.js` lines 260–267, `epub-reader.js` content hook

---

## Phase 2: Fix navigation & scrolling (the biggest UX complaints)

### 2A. Fix TOC navigation skipping chapters

**Bug**: `goToHref()` passes the TOC href directly to `rendition.display()`. epub.js's
`spine.get()` looks up the href in `spineByHref`, but TOC hrefs and spine hrefs often have
different path prefixes (e.g., `OEBPS/Text/chapter1.xhtml` vs `Text/chapter1.xhtml`). When
they don't match, navigation silently fails — the promise rejects but is never caught. Some
chapters match by coincidence, creating the "intro → chapter 4" skip.

**Fix**: Before calling `display()`, resolve the TOC href against the book's spine. Try
multiple lookup strategies: exact match, basename match, URI-decoded match. Log a warning if
no section is found. Await the promise and handle errors.

**Files**: `epub-reader.js` line 216, `main.js` lines 240–247

### 2B. Fix nested scrolling between iframe and container

**Bug**: `flow: 'scrolled-doc'` creates a scrollable container inside `.epub-viewer`. The
iframe inside it may also scroll. Plus `iframe.removeAttribute('scrolling')` (line 72)
re-enables iframe scrolling that epub.js intentionally disabled. This creates two competing
scroll contexts.

**Fix**: Remove `iframe.removeAttribute('scrolling')`. Ensure the epub.js container is the
only scrollable element. Set explicit `overflow: hidden` on the iframe body via injected CSS
so only the outer epub.js container scrolls.

**Files**: `epub-reader.js` lines 69–73, injected CSS at line 220

### 2C. Fix `next()`/`prev()` jumping entire sections instead of scrolling

**Bug**: In `scrolled-doc` mode, `rendition.next()` jumps to the next spine section, not the
next screen of content. Long chapters have no page-level navigation — the user must scroll
manually. But the prev/next buttons and arrow keys call `next()`/`prev()`, skipping entire
chapters.

**Fix**: In `scrolled-doc` mode, make `nextPage()` scroll the container by one viewport height
instead of calling `rendition.next()`. Only advance to the next section when scrolled to the
bottom. (Alternatively, switch from `scrolled-doc` to `paginated` flow, which gives proper
page-level prev/next but requires different CSS.)

**Files**: `epub-reader.js` lines 198–205

### 2D. Fix `100vh` cut off by mobile browser chrome

**Bug**: `#app { height: 100vh }` includes the area behind the mobile browser's URL bar.
Bottom content (nav buttons) is hidden.

**Fix**: Use `height: 100dvh` with `100vh` fallback. Add `min-height: 0` to `.reader-nav`
for proper flex shrinking.

**Files**: `style.css` lines 38, 284–288

---

## Phase 3: Fix lifecycle & resource management

### 3A. Add proper book close cleanup

**Bug**: `closeBook()` toggles CSS classes but doesn't destroy the rendition. The iframe,
event listeners, resize observers, and content hooks all persist. Opening multiple books
accumulates leaked resources.

**Fix**: Call `currentRendition.destroy()` and `currentBook.destroy()` in `closeBook()`. Clear
`currentRendition` and `currentBook`. Also add a cleanup function that removes stale event
handlers.

**Files**: `main.js` lines 250–254, `epub-reader.js` (new `destroyEpub()` export)

### 3B. Fix TOC click handler accumulation

**Bug**: Every `openBook()` call adds a new click listener to `#toc-list`. After N books,
N handlers fire on each TOC click, calling `goToHref` with hrefs from previous books.

**Fix**: Use event delegation with a single handler set up once in `bindEvents()`, or remove
the old handler before adding a new one.

**Files**: `main.js` lines 240–247

### 3C. Fix language change not re-highlighting

**Bug**: Changing the language while a book is open updates `currentLanguage` and stats, but
the epub content keeps the old language's word spans. Tapping words saves to the old language.

**Fix**: On language change, re-invoke `highlightContainer` on the current iframe document,
or reload the current section.

**Files**: `main.js` lines 174–178

### 3D. Fix stale rendition event handlers after destroy

**Bug**: epub.js's `destroy()` doesn't clean up event emitter listeners (the cleanup code is
commented out in the library). Old handlers from `setupWordTapHandler` persist and fire
alongside new ones.

**Fix**: Track all rendition event handlers and explicitly remove them before destroying.
Or use `rendition.removeAllListeners()` before destroy.

**Files**: `epub-reader.js` lines 102–183

---

## Phase 4: Harden the tokenizer & vocab store

### 4A. Fix French/Italian contractions split by fallback tokenizer

**Bug**: The regex fallback tokenizes `l'homme` as three tokens (`l`, `'`, `homme`). Users
get meaningless fragments like `l` and `t` as vocabulary items. The `Intl.Segmenter` path
handles this correctly but the fallback doesn't.

**Fix**: Add apostrophe (both `'` U+0027 and `'` U+2019) to the word character class in the
fallback regex. For CJK, add a comment noting that the fallback is inadequate without
`Intl.Segmenter`.

**Files**: `tokenizer.js` lines 37–38

### 4B. Add Unicode NFC normalization

**Bug**: The same character (e.g., `é`) can be NFC or NFD encoded. Different epub sources use
different forms. A word stored as NFC won't match an NFD lookup — the user marks it known but
it stays highlighted as unknown.

**Fix**: Add `.normalize('NFC')` to `normalizeWord()`.

**Files**: `tokenizer.js` line 64

### 4C. Fix Turkish İ/I casing

**Bug**: `toLowerCase()` without locale breaks Turkish. `I` → `i` (wrong, should be `ı`).

**Fix**: Accept locale in `normalizeWord()` and use `toLocaleLowerCase(locale)`.

**Files**: `tokenizer.js` line 64, `highlighter.js` lines 46, 65 (pass locale through)

### 4D. Fix IndexedDB rejected promise cached forever

**Bug**: If `openDB()` fails (permission denied, quota, Safari private browsing), the rejected
promise is cached. Every subsequent operation fails until page reload.

**Fix**: On rejection, set `dbPromise = null` so the next call retries.

**Files**: `vocab-store.js` lines 15–31

### 4E. Add import validation

**Bug**: `importVocab` blindly `put()`s whatever JSON is provided. Malformed entries corrupt
the database. Invalid levels cause `LEVEL_CLASSES[level]` to be `undefined`.

**Fix**: Validate each entry has `language` (string), `word` (string), `level` (0, 1, or 2).
Skip invalid entries with a warning count.

**Files**: `vocab-store.js` lines 127–136

---

## Phase 5: Polish & accessibility

### 5A. Add Escape key to close modals, suppress arrow keys in inputs

**Fix**: Add `keydown` handler for Escape → close settings modal / close TOC. Check
`e.target.tagName` before handling arrow keys to avoid navigating while typing.

**Files**: `main.js` lines 189–193

### 5B. Increase touch target sizes

**Fix**: Icon buttons to 44px min, toolbar buttons to `min-height: 44px`.

**Files**: `style.css` lines 94–107, 256–264

### 5C. Fix popup positioning on narrow viewports

**Bug**: The left-position correction can go negative on narrow screens, pushing the popup
off-screen.

**Fix**: Clamp left to `Math.max(10, ...)`.

**Files**: `highlighter.js` lines 183–191

### 5D. Render nested TOC items

**Bug**: Only top-level TOC items are rendered. Sub-chapters are invisible.

**Fix**: Recursively render `item.subitems` with indentation.

**Files**: `main.js` lines 237–239

### 5E. Add Firefox scrollbar styling

**Fix**: Add `scrollbar-width: thin; scrollbar-color: var(--border) var(--bg)` alongside
the webkit rules.

**Files**: `style.css` lines 509–525

---

## Implementation Order

| Priority | Phase | Items | Effort | User Impact |
|----------|-------|-------|--------|-------------|
| **P0** | 1 | 1A, 1B, 1C, 1D | ~2hr | Fixes broken core interactions |
| **P0** | 2 | 2A, 2B, 2C, 2D | ~3hr | Fixes scrolling and navigation |
| **P1** | 3 | 3A, 3B, 3C, 3D | ~2hr | Prevents state corruption over time |
| **P1** | 4 | 4A–4E | ~2hr | Fixes data integrity for non-English |
| **P2** | 5 | 5A–5E | ~1hr | Polish and accessibility |
