# UX Protocol for Code Projects

A reusable checklist and methodology for building UX-aware software,
designed so that **code alone** communicates UI intent clearly enough
for heuristic evaluation, cognitive walkthroughs, and automated testing
without needing a running application.

---

## 1. UI State Documentation

Every module that owns UI should declare its state machine in the
module header. This is the single most impactful thing for enabling
code-based UX analysis.

### What to document

```
State name    Trigger              What the user sees
──────────────────────────────────────────────────────
EMPTY         no data loaded       empty state message, CTA
LOADING       async fetch started  spinner or skeleton
POPULATED     data available       content list/grid
ERROR         fetch failed         error message + retry
```

### Rules

- **Name every state.** If a state has no name, it will be overlooked
  in testing and review. Use UPPER_SNAKE names in comments.
- **Document transitions.** Which user action or system event moves
  between states? Include the function name that triggers each.
- **Document what resets.** When a panel opens/closes, which variables
  reset and which persist? This is where stale-state bugs hide.
- **Document what syncs.** If JS state and DOM state can diverge
  (e.g. a checkbox `checked` vs a JS boolean), note where they sync.

### Example (from this project)

```js
/**
 * ── UX State Machine ───────────────────────────────────
 *
 *   isBookLoaded()  ×  inBookOnly
 *   ─────────────────────────────────────────────────────
 *   false × false   NO_BOOK       Toggle disabled.
 *   true  × false   BOOK_DB_ONLY  Toggle available.
 *   true  × true    BOOK_ACTIVE   Scanned, all words shown.
 *   true  × true    BOOK_SCANNING Transient scan state.
 *
 * openPanel():
 *   ALWAYS resets:  searchQuery
 *   RESETS on book change: bookWordSet, inBookOnly
 *   PRESERVES across re-opens: activeFilter
 */
```

---

## 2. Visual Symbol Registry

Any symbol shown to users (icons, badges, status indicators) must be
documented in one central place per module.

```
Symbol  Level  CSS class    Meaning (user-facing)
────────────────────────────────────────────────────
?       0      vb-unknown   Unknown — haven't learned yet
~       1      vb-partial   Learning — recognized but not solid
✓       2      vb-known     Known — confident in this word
```

### Rules

- **Map every symbol to its meaning.** Don't assume `~` is obvious.
- **Use named constants.** `SYMBOL_UNKNOWN` is greppable; `'?'` is not.
- **List where each symbol appears.** "Filter buttons, word badges,
  group mark buttons" prevents surprise when changing one.

---

## 3. Event Delegation Map

When using delegated event handlers on a parent container, document
the dispatch priority:

```
Priority order (first match wins, then returns):
  1. .vb-group-mark   → markGroup()   — bulk level change
  2. .vb-group-header  → toggle        — expand/collapse group
  3. .vb-word-row      → cycleWord()   — cycle single word
```

This prevents click-swallowing bugs and makes the handler's intent
readable without tracing DOM structure mentally.

---

## 4. Clarity of Labels, Copy, and Affordance

The most common UX failure mode in developer-built UI: controls that
make sense to the person who wrote the code but not to anyone else.

### The Verb Test

Every button label should answer: **"What will happen when I click this?"**

```
Bad:   "Aa"          → What does this do?
Bad:   "✕"           → Close what? The panel? The book? The app?
Bad:   "All known"   → All of WHAT is known? Or mark all AS known?
Good:  "📖 Vocab"    → Opens vocabulary browser
Good:  "Close book"  → Closes the book
Good:  "✓ Page known" → Marks this page as known
```

### The Noun Test

Every status label should answer: **"What am I looking at?"**

```
Bad:   "In this book" (checkbox)  → Is this a count? A filter? A toggle?
Good:  "Show book words" or auto-enabled with clear status text
Bad:   "3 unique"     → 3 unique what?
Good:  "3 unique words in this book"
```

### The Stranger Test

Show the UI (or describe it) to someone who has never seen it.
Ask them to narrate what each element does. Every wrong guess is a
clarity bug. Common failures:

- **Symbol-only buttons** — `~` means nothing to a newcomer
- **Ambiguous scope** — "Close" when multiple things can close
- **State as label** — "In this book" sounds like information, not a
  toggle. Labels for toggles should be imperative: "Show book words"
- **Jargon** — "stem", "level 0", "DB-only" are developer terms

### Rules

- **Every button needs a verb.** Not a noun, not a symbol alone.
- **Every toggle needs to describe what enabling it does.**
  Not what state it represents.
- **Destructive actions need a noun.** "Forget" → "Forget all words".
  "Delete" → "Delete this book's words".
- **Error states need a next action.** "No words found" → "No words
  found. Try uploading a book or tapping words while reading."
- **Status text needs units.** "3" → "3 words". "42%" → "Scanning: 42%".

### Code-level enforcement

Search for these patterns to find clarity issues:
```bash
# Buttons with no text content (icon-only without aria-label)
grep -r '<button' | grep -v 'aria-label' | grep -v 'btn-label'

# Elements with single-character text (likely symbols)
grep -rP '>[?~✓✕×☰⚙⇩⇧]<' src/

# Placeholder text that doesn't explain what to do
grep -r 'placeholder=' | grep -v 'Search\|Enter\|Type'
```

---

## 5. Progressive Disclosure for Controls

The clutter-vs-clarity tradeoff for interactive elements:

### Pattern: icon + label hybrid

```html
<button title="Full tooltip with keyboard shortcut (K)">
  ✓<span class="btn-label"> Page known</span>
</button>
```

```css
/* Desktop: icon + text */
.btn-label { /* visible by default */ }

/* Mobile: icon only, label hidden */
@media (max-width: 600px) {
  .btn-label { display: none; }
}
```

### Rules

- **Desktop shows icon + short label.** Supports recognition.
- **Mobile shows icon only.** Saves space; title/aria-label covers
  accessibility.
- **Every interactive element needs a `title` attribute** that
  includes the keyboard shortcut if one exists.
- **Every icon-only element needs `aria-label`** for screen readers.
- **Minimum touch target: 44×44px** on mobile (Apple HIG / WCAG).

---

## 6. Cognitive Walkthrough Protocol

Run this for every significant UI feature, with **4 user archetypes**:

| Archetype      | Characteristics                              |
|----------------|----------------------------------------------|
| **Newcomer**   | First session, no mental model of the app    |
| **Regular**    | Uses the core feature daily, has habits      |
| **Power user** | Uses all features, expects efficiency        |
| **Mobile user**| Phone, touch-only, constrained viewport      |

### For each task, walk through:

1. **Will the user notice the control?** (Visibility)
2. **Will they understand what it does?** (Affordance)
3. **Will they know it worked?** (Feedback)
4. **Can they recover from mistakes?** (Undo/forgiveness)

### Format

```
Task: "See which words in this book I don't know"
Newcomer:  Doesn't notice checkbox → FIX: auto-enable book mode
Regular:   Works after learning → OK
Power:     Wants batch operations → FUTURE: multi-select
Mobile:    Button too small → FIX: increase touch target
```

---

## 7. Heuristic Evaluation Checklist

Run against Nielsen's 10 heuristics. Score each 0-4 (0 = no issue,
4 = usability catastrophe).

| # | Heuristic                        | What to check in code                                |
|---|----------------------------------|------------------------------------------------------|
| 1 | Visibility of system status      | Loading states, progress indicators, status text     |
| 2 | Match real world                 | Label text, metaphors, natural language              |
| 3 | User control and freedom         | Undo, cancel, close, escape key                      |
| 4 | Consistency and standards        | Same symbols mean same thing everywhere              |
| 5 | Error prevention                 | Disabled states, confirmation for destructive actions |
| 6 | Recognition over recall          | Labels on buttons, tooltips, visible state           |
| 7 | Flexibility and efficiency       | Keyboard shortcuts, bulk actions, smart defaults     |
| 8 | Aesthetic and minimalist design  | No unnecessary info, progressive disclosure          |
| 9 | Help users recognize errors      | Error messages are specific and constructive          |
|10 | Help and documentation           | Onboarding hints, contextual help                    |

### Code-level checks for each

- **H1**: Search for `loading`, `spinner`, `progress`, `status`. Is every
  async operation represented visually?
- **H3**: Search for `undo`, `cancel`, `Escape`. Does every destructive
  action have an undo path?
- **H4**: Grep for all symbol constants. Is each used consistently?
- **H5**: Search for `.disabled`, `:disabled`. Are destructive buttons
  disabled when preconditions aren't met?
- **H6**: Search for elements with no `title`, no `aria-label`, and no
  visible text content. These are recognition failures.
- **H7**: Search for `keydown`, `shortcut`. Do power-user accelerators
  exist for frequent actions?

---

## 8. Testing for Visual and Interaction Continuity

### State transition tests

Test every transition in the state machine, not just the happy path:

```js
// Test: NO_BOOK → open panel → shows empty state
// Test: BOOK_DB_ONLY → check toggle → BOOK_ACTIVE
// Test: BOOK_ACTIVE → close book → NO_BOOK (state cleared)
// Test: BOOK_ACTIVE → switch book → new BOOK_ACTIVE (stale state cleared)
```

### Cross-state consistency tests

```js
// After every state change, verify:
// 1. DOM reflects JS state (checkbox.checked === inBookOnly)
// 2. Dependent UI updated (forget button enabled/disabled)
// 3. Status text matches state (word count, "No book open", etc.)
```

### Undo symmetry tests

```js
// For every action with undo:
// 1. Perform action → verify new state
// 2. Click undo → verify original state EXACTLY restored
// 3. Verify DB calls match (setLevel called with original values)
```

### Mobile-specific tests

If using JSDOM (which doesn't do layout), document viewport
assumptions as comments and test what you can:

```js
// VIEWPORT ASSUMPTION: at 375px, .btn-label is hidden (CSS media query)
// We can't test CSS media queries in JSDOM, but we CAN test:
// - aria-label exists on every icon-only button
// - title attribute exists on every button
// - Touch targets: element has min-width/min-height in CSS (audit manually)
```

### Empty state tests

Every UI container should have an explicit empty state test:

```js
it('shows empty state when no words saved', ...);
it('shows empty state when filter matches nothing', ...);
it('shows empty state when book scan returns no words', ...);
```

---

## 9. Module API Design for UX Observability

### Export state queries, not just actions

```js
// Bad: only exports actions
export function openPanel() { ... }
export function closePanel() { ... }

// Good: also exports state queries
export function isOpen() { ... }
export function isBookLoaded() { ... }
export function getBookId() { ... }
```

State queries let other modules (and tests) ask "what state are we
in?" without reaching into private variables or inspecting DOM.

### Single source of truth for UI state

```js
// Bad: state split between JS and DOM
let inBookOnly = false;
// ...somewhere else: bookCb.checked = true;
// Now JS says false, DOM says true

// Good: JS is authoritative, DOM is derived
let inBookOnly = false;
function syncCheckbox() {
  bookCb.checked = inBookOnly;
}
```

### Reset functions as first-class exports

```js
// Export a reset function for every lifecycle boundary
export function resetBookState() {
  bookWordSet = null;
  lastBookId = null;
  inBookOnly = false;
}
```

Callers (like a `closeBook` handler) shouldn't need to know which
internal variables exist — they just call `resetBookState()`.

---

## 10. CSS Responsive Audit Checklist

For every component, verify at three breakpoints (mobile 375px,
tablet 768px, desktop 1280px):

| Check                          | How to verify in code                          |
|--------------------------------|------------------------------------------------|
| Nothing overflows viewport     | No fixed widths > 100vw; flex-wrap on containers|
| Touch targets >= 44px          | Min-width/min-height on buttons in mobile media |
| Text is readable               | Font-size >= 12px at all breakpoints            |
| Scroll areas have momentum     | `-webkit-overflow-scrolling: touch` on scroll containers |
| Fixed elements avoid OS chrome | `bottom` values account for gesture bars (40px+) |
| Panels don't trap focus        | Escape key closes; outside-click closes          |
| Keyboard doesn't break layout  | Inputs don't cause resize; scroll position stable|

---

## 11. Meta-Protocol: When to Run What

| Trigger                        | Run                                            |
|--------------------------------|------------------------------------------------|
| New feature added              | Cognitive walkthrough (4 archetypes)            |
| UI refactor                    | Heuristic evaluation (10 heuristics)            |
| New component/panel            | State machine documentation + transition tests  |
| Bug report "X doesn't work"   | State trace: which state were they in?          |
| Before release                 | Full responsive audit + empty state review      |
| New developer onboarding       | Read state machine docs, run walkthrough        |

### Meta: documentation that enables all of the above

These three things in a module header enable every protocol above
to be run **from code alone**, without launching the app:

1. **State machine** — what states exist, what triggers transitions
2. **Symbol registry** — what visual symbols mean
3. **Reset/lifecycle docs** — what persists, what clears, when

If these three are accurate, a reviewer can do a full cognitive
walkthrough by reading code. If any is missing, they have to run
the app and click around, which is slower and misses edge states.
