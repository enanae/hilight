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

---

## 12. Audit Blindspot Catalog

Heuristic evaluations and cognitive walkthroughs have systematic
failure modes. Even experienced auditors miss the same categories
of issues repeatedly. This section catalogs those blindspots so
audits can explicitly check for them.

### BS1: Icon–Action Coherence

**The problem:** An icon carries universal meaning that can
contradict the label next to it. Auditors check whether a label
is clear in isolation, but don't check whether the icon *overrides*
the label's meaning in the user's mind.

**Why it's missed:** Heuristic evaluations assess labels and icons
separately ("Is the label clear?" "Does the icon have a tooltip?").
They don't ask: "If the icon and label disagree, which one wins?"
Icons win. Always. They're processed pre-attentively.

**Examples of failure:**
- ✕ next to "Close book" — ✕ universally means "dismiss this
  element" (close a panel, dismiss a toast). Users will interpret
  it as closing the nearest container, not the book.
- ↓ next to "Save" — ↓ means "download" in most UIs, not "persist
  to database."
- ☰ for "Table of contents" — ☰ means "menu" everywhere else.

**Audit check:** For every icon+label pair, ask: *"If I covered
the label, what would a stranger think this icon does?"* If the
answer differs from the label, the icon is wrong, not the label.

### BS2: Toolbar Gestalt — Evaluating Buttons in Groups

**The problem:** Buttons are audited individually ("Is this label
clear?") but users perceive toolbars as a group. A button that
makes sense alone can fail in context because:

- It looks identical to its neighbors (same size, same style),
  making the toolbar feel like undifferentiated soup.
- Its purpose is rare/destructive but it sits next to frequent
  actions with the same visual weight, creating accidental
  activation risk.
- Its meaning shifts depending on which buttons surround it.

**Why it's missed:** Cognitive walkthroughs test one task at a time.
They ask "Can the user find this button?" but not "Can the user
distinguish this button from the five others next to it?"

**Audit check:** Screenshot or mentally render the full toolbar.
Ask: *"If I blur my eyes, can I still tell which button is which?"*
If all buttons look the same, the toolbar fails regardless of how
good each individual label is.

### BS3: Scope Inference from Placement

**The problem:** The same control means different things depending
on where it appears. A "Close" button in a modal closes the modal.
A "Close" button in a toolbar closes... what? The toolbar? The
panel? The book? The app? Users infer scope from spatial context.

**Why it's missed:** Auditors evaluate the control in the context
they designed it for. They know "Close" means "close the book"
because they wrote the code. A stranger sees "Close" in a toolbar
next to other toolbar actions and assumes it closes the toolbar
or the nearest open panel.

**The rule:** Controls must either:
1. Name their scope explicitly ("Close book", "Close panel"), or
2. Be placed inside the thing they act on (a ✕ inside a panel
   header clearly closes that panel).

**Audit check:** For every action button, ask: *"If this button
were in a different container, would its meaning change?"* If yes,
the label needs a noun.

### BS4: Frequency–Prominence Mismatch

**The problem:** A button that's used rarely (or once per session)
occupies premium toolbar space alongside frequently-used actions.
This wastes screen real estate on mobile and creates confusion
about what the "core" actions are.

**Why it's missed:** Audits check "Is every needed action
accessible?" but not "Is this action accessed *often enough* to
justify its placement?" Every feature's owner thinks their button
deserves top-level placement.

**The rule:** Toolbar space is proportional to usage frequency.
Actions used less than once per reading session belong in menus,
panels, or settings.

**Audit check:** Rank every toolbar button by expected uses per
session. If a button is used ≤1 time per session and the toolbar
has more than 4 items, it should be demoted to a secondary location.

### BS5: Layout-Dependent Issues Are Invisible to Text-Level Audits

**The problem:** Auditing individual labels, icons, and controls
catches semantic issues but misses spatial ones. You can't detect
these by reading code:

- A toolbar that wraps to 3 rows on narrow screens
- Two buttons that are 12px apart on mobile (below 44px touch gap)
- A panel that covers 100% of the viewport with no backdrop or
  outside-click to dismiss
- A control that's technically present but scrolled below the fold

**Why it's missed:** Code-level audits operate on strings and DOM
structure, not on rendered layout. CSS media queries create
entirely different layouts that are invisible until you actually
render at that breakpoint.

**Audit check:** For every component, mentally render it at three
widths: 375px (phone), 768px (tablet), 1280px (desktop). Ask at
each: *"Does anything overflow, wrap unexpectedly, overlap, or
become unreachable?"* If you can't answer confidently without
running the app, that's the blindspot.

### BS6: The Auditor's Curse — You Can't Stranger-Test Your Own Work

**The problem:** The person who wrote the code (or the AI that
generated it) cannot reliably perform the Stranger Test on their
own output. They know what every button does because they just
built it. This makes it impossible to genuinely evaluate first-use
discoverability.

**Why it's missed:** It's not that the audit step is missing — it's
that the auditor executing it has disqualifying knowledge. Knowing
the intended behavior of a control makes it impossible to see that
control as ambiguous.

**Mitigations:**
1. **Time delay:** Audit your own UI at least one day after
   building it, when the details have faded from working memory.
2. **Explicit role-play:** Before checking each control, write
   down what you think a stranger would guess it does BEFORE you
   check what it actually does. If you can't separate your
   knowledge from the stranger's, assume the control is ambiguous.
3. **Checklist forcing function:** For every interactive element,
   fill in this template:
   ```
   Element: [description]
   Icon alone says: [what the icon implies]
   Label alone says: [what the text implies]
   Together they say: [combined meaning]
   Actual function: [what it really does]
   Mismatch? [yes/no]
   ```
   If any row has a mismatch, fix it.
4. **External review:** If possible, show the UI to someone who
   hasn't seen it before and ask them to narrate. Every wrong
   guess is a bug.

### Applying Blindspot Checks

Add these to the evaluation protocol in §11:

| Trigger                        | Also run                                       |
|--------------------------------|------------------------------------------------|
| New toolbar/button bar         | BS1 (icon coherence), BS2 (gestalt), BS4 (freq)|
| Any "Close"/"Delete"/"Remove"  | BS3 (scope inference), BS1 (icon coherence)     |
| Mobile layout change           | BS5 (layout-dependent), BS2 (toolbar gestalt)   |
| Self-audit (no external review)| BS6 (auditor's curse checklist)                 |
