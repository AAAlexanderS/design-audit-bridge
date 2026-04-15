---
name: figma-to-frontend-handoff
description: Use this skill when preparing, executing, or troubleshooting the handoff process from Figma designs to frontend implementation. Covers the full workflow — readiness review, MCP-driven code generation, accessibility audit, internationalization preparation (including RTL and CJK/Latin mixed typography), versioning and deprecation, QA parity checks, and post-ship maintenance. Use when a design is ready for dev handoff, when engineers report issues implementing a Figma design, when auditing a shipped feature against its source design, or when establishing handoff protocols for a new team. Pairs with figma-naming-conventions (which governs the Figma file itself); this skill governs what happens at and after the handoff boundary. Do NOT use for initial design exploration, visual design critique, or pure Figma hygiene unrelated to implementation.
---

# Figma to Frontend Handoff

Full-stack handoff playbook: from "design looks done" to "shipped and verified." Assumes figma-naming-conventions is already applied to the source file. Optimized for Figma MCP-driven codegen with cross-stack design token export.

## Core Principles

**[MUST] Handoff is a checkpoint, not a throw-over.** The design is not "handed off" when the designer marks it ready. It is handed off when an engineer has confirmed they can build it, the tokens resolve, and the MCP output is usable. Until then the designer is still on the hook.

**[MUST] Code is the source of truth for behavior. Figma is the source of truth for intent.** When they diverge, the question is always "whose intent was this?" not "who's right?"

**[MUST] Every handoff produces three artifacts:** the design file itself, a handoff note (written, not verbal), and a parity baseline (screenshots or a shipped URL) that future audits can check against.

**[SHOULD] Optimize for the engineer's first 10 minutes.** If an engineer opens the Figma link and can't figure out where to start within 10 minutes, the handoff has failed regardless of how polished the design is.

---

## The Handoff Pipeline

Six stages. Each has entry criteria, actions, and exit criteria. Skipping stages is allowed only when the previous stage's exit criteria are already satisfied.

```
1. Readiness   →  2. Package   →  3. Handoff   →  4. Build   →  5. Parity   →  6. Ship
   (designer)      (designer)      (both)          (engineer)    (both)        (both)
```

---

## Stage 1: Readiness Review

**Goal:** Confirm the design is actually ready to hand off. This is the stage where most problems get caught cheaply.

**Entry:** Designer believes the design is done.

### Readiness Checklist

- ☐ All frames marked `[Ready]` per figma-naming-conventions status tags
- ☐ figma-naming-conventions pre-handoff checklist fully passed
- ☐ All referenced components resolve to the Components page (no local copies)
- ☐ All colors, spacing, radii, and typography come from Variables (no hardcoded values)
- ☐ All breakpoints required by the feature are present (at minimum Mobile + Desktop)
- ☐ Empty states, loading states, and error states are designed — not just the happy path
- ☐ Edge cases: long text, missing image, zero items, 10,000 items, offline
- ☐ Every interactive element has hover/active/disabled/focus states defined somewhere (either as variants or in a states reference frame)
- ☐ All copy is final, not lorem ipsum or placeholder text
- ☐ Motion and transitions documented if non-trivial (Figma prototypes or a separate note)

**Exit:** All boxes checked. Any unchecked box either blocks handoff or is explicitly deferred in writing.

### Common Readiness Failures

- **"The engineer can figure out the error state."** No. If you didn't design it, it will be built inconsistently. Design every state or accept that engineering will improvise.
- **"Dark mode is out of scope for v1."** Fine, but declare it explicitly. Otherwise tokens will be bound to light-mode-only values and dark mode becomes a refactor.
- **"Copy is TBD from marketing."** Then handoff is also TBD. Placeholder copy hides layout bugs that only surface with real text.

---

## Stage 2: Package the Handoff

**Goal:** Produce the artifacts an engineer needs to build without synchronous conversation.

**Entry:** Readiness review passed.

### The Handoff Note

**[MUST]** Every handoff ships with a written note. Template:

```markdown
# Handoff: [Feature Name]

**Figma:** [link to specific frame, not the file root]
**Status:** Ready
**Breakpoints:** Mobile, Desktop  (+ Tablet if applicable)
**Scope:** [1-2 sentences of what's in, what's out]

## Components used
- Existing: Button/Primary, Card/Product, Input/Text
- New: FilterChip (new component, spec'd on Components page)

## Tokens introduced
- color/bg/promo (new semantic token, references Primitives/color/amber/500)
- space/2xl (new)

## States
- Empty, Loading, Error, Populated (all on the Figma page)
- Hover/Active/Disabled: handled by component variants
- Focus: standard focus ring token (color/border/focus)

## Copy source
- Final copy embedded in Figma
- i18n keys: see i18n section below, or [link to string file]

## Known open questions
- Should filter chips persist across sessions? → Waiting on PM
- Animation timing for chip selection: using duration/fast, confirm with eng

## Out of scope
- Dark mode (v2)
- Tablet breakpoint (v2)
- Analytics events (separate doc)
```

**[MUST]** Link to a specific frame, not the file root. Engineers should land on exactly what they need to build.

**[SHOULD]** Embed the handoff note somewhere engineers will actually find it — PR description, Linear/Jira ticket, or a pinned comment on the Figma frame itself. Not Slack, not email — those get lost.

### MCP Readiness

If the team uses Figma MCP, validate that MCP output is usable BEFORE handoff, not after:

- ☐ Run `get_code` or equivalent on the primary frame
- ☐ Verify returned component names match the Figma component names
- ☐ Verify token references resolve (not hardcoded hex)
- ☐ Verify layer names become semantic class names (not `div-1`, `frame-2`)
- ☐ Verify nesting depth is reasonable (<5 per component)

If MCP output is garbage, fix the Figma file before handoff. Garbage MCP output means the engineer will hand-write what MCP should have generated, which defeats the point of having MCP.

---

## Stage 3: The Handoff Moment

**Goal:** Transfer ownership of implementation to engineering while designer remains available for questions.

**Entry:** Package is ready.

### The Handoff Meeting (if synchronous)

**[SHOULD]** 15–30 minutes, not longer. Agenda:

1. **Walk the happy path** (5 min) — designer clicks through the primary flow
2. **Walk the edge cases** (5 min) — empty, error, long text, zero state
3. **Tokens and components introduced** (5 min) — what's new
4. **Open questions** (5 min) — known unknowns
5. **Engineer asks questions** (10 min) — this is the most valuable part

**[MUST NOT]** Walk through the Figma file pixel by pixel. If the engineer needs that level of detail, the design isn't ready or the naming is wrong.

### The Async Handoff (preferred when possible)

Synchronous meetings scale badly. For simple handoffs or distributed teams:

1. Designer posts the handoff note in the ticket
2. Engineer reviews async within 1 business day
3. Engineer posts questions as comments on the Figma frame
4. Designer answers within 1 business day
5. Once questions are resolved, handoff is complete

**[SHOULD]** Budget 1–2 async rounds before declaring the handoff complete. Zero rounds means the engineer didn't read carefully.

### The Handoff Contract

Once handoff is complete, both sides commit to:

**Designer commits to:**
- Not silently changing the design after handoff (see Change Management section)
- Being reachable for questions within 1 business day
- Doing parity review before ship

**Engineer commits to:**
- Asking before deviating from the design
- Flagging impossible or expensive requirements early, not at the end
- Using the design tokens, not hardcoding values

---

## Stage 4: Build Phase Support

**Goal:** Keep engineering unblocked without the designer rebuilding the design in Figma comments.

### Question Triage

When an engineer asks a question, classify it:

| Question type | Response |
|---|---|
| "What does this look like at X?" | Answer with a screenshot, update Figma if the state was missing |
| "Can we do X instead?" (perf/feasibility) | Evaluate trade-off, decide in writing, update Figma |
| "I can't find the token for X" | Check if it exists; if not, add it and note in the handoff thread |
| "Is this a bug or intentional?" | Answer unambiguously; update Figma if it was ambiguous |
| "Can you just build it with me?" | Decline unless it's a design bug. This is scope creep in disguise |

**[MUST]** Every answered question that revealed a design gap results in a Figma update. The file is the source of truth and must stay current.

### Mid-Build Design Changes

**[MUST NOT]** Change the design silently during build. If you updated a color, spacing, or layout after handoff, the engineer doesn't know and will ship the old version.

**[MUST]** Any post-handoff change follows this protocol:
1. Update Figma
2. Post in the handoff thread: "Change: [what], [why], impact: [scope]"
3. Flag whether the change is breaking (blocks current PR) or non-breaking (can be a follow-up)
4. If breaking, get explicit acknowledgment from the engineer

**[SHOULD]** Bundle small changes. If you have 5 small tweaks, post them together once rather than 5 separate pings.

---

## Stage 5: Parity Review

**Goal:** Verify the built implementation matches design intent before it ships.

**Entry:** Engineer says "ready for design review" (typically on a staging URL or PR preview).

### Parity Checklist

Review on actual devices or at minimum actual browser windows at target breakpoints — not Figma.

**Structural parity:**
- ☐ All specified breakpoints render correctly
- ☐ Layout uses the intended DOM structure (check DevTools)
- ☐ All states render: empty, loading, error, populated, hover, focus, disabled

**Token parity:**
- ☐ Colors match (use a color picker if in doubt — eyeballing at low contrast is unreliable)
- ☐ Spacing matches (DevTools computed styles)
- ☐ Typography matches (font, size, weight, line-height, letter-spacing)
- ☐ Radii and borders match

**Content parity:**
- ☐ Real content, not lorem ipsum
- ☐ Copy exactly matches Figma (typos, punctuation, casing)
- ☐ Images load, have correct aspect ratios, and have alt text

**Interaction parity:**
- ☐ Hover/focus/active states work as designed
- ☐ Transitions use the correct duration and easing
- ☐ Keyboard navigation works (tab order, focus ring)
- ☐ Touch targets are minimum 44×44pt on mobile

### Issue Classification

Not every discrepancy is a blocker. Classify:

| Severity | Definition | Resolution |
|---|---|---|
| **P0 Blocker** | Breaks the feature, fails accessibility, wrong content | Fix before ship |
| **P1 Major** | Visible design deviation from tokens or layout | Fix before ship if cheap, file follow-up if expensive |
| **P2 Minor** | Subpixel or low-impact visual nit | File follow-up, don't block |
| **P3 Nit** | Preference, not spec | Ignore or file for later |

**[MUST NOT]** Block ship on P2/P3 issues. This erodes trust and slows delivery. Your design is not more important than the product shipping.

**[SHOULD]** Write parity feedback as a numbered list with severity tags:

```
1. [P0] "Sign up" button missing on mobile breakpoint
2. [P1] Card padding is 12px, should be space/md (16px)
3. [P2] Focus ring is 1px, should be 2px — file follow-up
4. [P3] Heading kerning looks slightly tight — leave as-is
```

---

## Stage 6: Ship and Post-Ship

**Goal:** Lock in the baseline for future audits and capture learnings.

### At Ship Time

**[MUST]** Update the Figma frame status from `[Ready]` to `[Shipped]`.
**[MUST]** Capture shipped screenshots and attach to the Figma frame or handoff note. These become the parity baseline for future changes.
**[SHOULD]** Note any post-handoff deviations that made it into the shipped version — these are the places Figma and reality diverge, and future designers need to know.

### Post-Ship Audit

**[SHOULD]** 1 week after ship, do a quick audit:
- Does it still match the design in production?
- Did any tokens drift (e.g., engineering hardcoded a color that should have been tokenized)?
- Any user feedback on the shipped version that reveals a design miss?

**[SHOULD]** 1 month after ship, check if the component is being reused correctly in other features. Misuse is a documentation problem, not a user problem — fix the component description or add a usage example.

---

## Accessibility Review

**[SHOULD]** Integrate a11y into the handoff at two points: during readiness review and during parity review. Not a separate phase.

WCAG 2.2 AA is the target baseline unless the team has committed to AAA.

### Readiness-Stage a11y Checks

These are design-time concerns the engineer cannot fix alone.

- ☐ **Color contrast:** All text/background pairs meet WCAG AA (4.5:1 for body, 3:1 for large text and UI components). Use the Figma "Contrast" or "Able" plugin.
- ☐ **Non-color indicators:** Interactive states do not rely on color alone. Error = red + icon + text, not just red.
- ☐ **Touch targets:** Minimum 44×44pt on mobile. Small visual elements need padded hit areas.
- ☐ **Text sizing:** Body text ≥ 14pt (16pt preferred). No text below 12pt except timestamps/legal.
- ☐ **Focus order:** Tab order is intuitive and defined (for complex flows, annotate it).
- ☐ **Alt text:** Every meaningful image has alt text in the Figma layer description.
- ☐ **Heading hierarchy:** Text layers use semantic heading roles (`heading-1`, `heading-2`, etc.) in a correct order — no skipping from h1 to h4.
- ☐ **Form labels:** Every input has a visible label, not just placeholder text.
- ☐ **Motion:** No rapidly flashing content (>3Hz). Honor prefers-reduced-motion.

### Parity-Stage a11y Checks

These verify engineering implemented the a11y intent correctly.

- ☐ Semantic HTML: headings are `<h1>`–`<h6>`, buttons are `<button>`, links are `<a>`
- ☐ ARIA labels present where needed (icon-only buttons, form fields)
- ☐ Keyboard navigation works end-to-end without a mouse
- ☐ Focus is visible on every interactive element
- ☐ Screen reader announces meaningful content (test with VoiceOver on Mac or NVDA on Windows)
- ☐ Form errors are announced, not just shown visually
- ☐ Dynamic content updates use `aria-live` appropriately

### A11y Escalation

**[SHOULD]** Treat WCAG AA failures as P0 or P1, not P2. "The focus ring is missing" is a blocker even if it's visually small.

**[MUST NOT]** Ship with known WCAG AA violations in interactive elements without explicit written approval from the team lead. File a follow-up at minimum.

---

## Internationalization (i18n)

**[MUST]** If the product ships in more than one language, i18n is part of handoff, not a separate workstream.

### Text Length Elasticity

**[MUST]** No text layer has fixed width. Use "Hug" or "Fill container" in Auto Layout.

**[MUST]** Design for the longest expected translation, not the English version:
- German is typically 30% longer than English
- French and Spanish are typically 15–25% longer
- Chinese and Japanese are typically shorter but taller (line-height matters more)
- Arabic and Hebrew are RTL and also typically longer

**[SHOULD]** Design critical screens in at least two languages — one short (English or Chinese) and one long (German) — to catch layout breaks early.

### CJK / Latin Mixed Typography

This section is specific to products that mix Chinese/Japanese/Korean with Latin text. Common in China-based products, creator tools, international e-commerce.

**[MUST]** Specify primary font + fallback in text styles:
- Primary: the designed CJK font (e.g., PingFang SC, Noto Sans SC)
- Fallback: a Latin font that harmonizes with the CJK font (e.g., Inter, SF Pro)
- The fallback order matters: CJK-first for zh/ja/ko locales, Latin-first for en locales

**[MUST]** Line height for CJK text is typically larger than Latin. Use `font/line-height/cjk` and `font/line-height/latin` as separate tokens, or a single token tuned for the worst case (usually CJK).

**[SHOULD]** Avoid italic styles — most CJK fonts don't have true italics, and synthesized italics look wrong. Use weight or color for emphasis instead.

**[SHOULD]** Punctuation mixing: Chinese punctuation (，。！？) takes full-width space and looks awkward mixed with Latin. Design team should pick one convention per language and document it.

**[MUST]** Numbers and Latin characters inside CJK text should use the Latin font, not the CJK font's Latin glyphs (which are often poorly designed). This is a text style concern, not a per-layer concern.

### RTL Support

If the product ships in Arabic, Hebrew, Farsi, or Urdu:

**[MUST]** Layout must mirror for RTL. This is not just text direction — icons, padding, borders, and layout order all flip.

**[MUST NOT]** Hardcode directional language in tokens. Use logical properties:
- ❌ `margin-left` / `margin-right`
- ✅ `margin-inline-start` / `margin-inline-end`
- ❌ `space/left/md`
- ✅ `space/inline-start/md`

**[SHOULD]** Icons with directional meaning (arrows, back buttons, chevrons) need RTL variants. Mark them explicitly in the component name: `icon-chevron-right` flips to `icon-chevron-left` equivalent in RTL.

**[SHOULD]** Test critical screens in an RTL locale before ship. The Figma "Mirror" plugin or manual frame mirroring works.

### i18n Handoff Artifacts

**[MUST]** The handoff note includes:
- List of supported locales
- String keys (or a link to the string file) for all user-visible copy
- Any locale-specific layout variations
- Known long-translation screens (if you tested German/Russian and found issues)

**[SHOULD]** String keys follow a consistent convention matching the frontend i18n library. Example: `checkout.payment.submit_button` not `Submit_Button_Label`.

---

## Change Management & Versioning

Designs change after ship. How that change is managed determines whether the design system stays coherent or fragments.

### Versioning Components

**[MUST]** Use Figma's Library publishing workflow. Every component change ships as a library update.

**[MUST]** Breaking changes require a new variant or a new component, not silent modification:
- Adding a new optional property: non-breaking, update in place
- Removing a property: breaking, deprecate the old component
- Changing default behavior: breaking, deprecate the old component

### Deprecation Protocol

**[MUST]** Deprecated components follow this lifecycle:

1. **Announce:** Rename to `Button/Primary [deprecated]`, update description with migration path, post in the team channel
2. **Grace period:** Minimum 2 weeks (longer for heavily used components). Old component still works.
3. **Move:** After grace period, move to the `🗂 Archive` page. Instances in other files still resolve.
4. **Remove:** Only remove from the library after telemetry or a manual check confirms zero active usage. Never unpublish without this check.

**[MUST NOT]** Delete a published component. Unpublishing breaks every instance in every file that uses it.

### Communicating Changes

**[MUST]** Every library update has a changelog entry in the `📖 README` page:

```
## 2026-04-07
### Added
- Card/Product: new `isOutOfStock` boolean property
- color/bg/promo semantic token

### Changed
- Button/Primary: default size changed from md to lg (breaking — old instances will resize)

### Deprecated
- Banner/Legacy → use Banner/V2. Grace period until 2026-04-21.
```

**[SHOULD]** Breaking changes go in a separate announcement, not just the changelog. Engineers don't read changelogs by default.

---

## Troubleshooting Common Failures

### "MCP is returning garbage code"

Likely causes (in order of frequency):
1. Layer names are Figma defaults (`Frame 1247`) — fix in the file per figma-naming-conventions
2. Components aren't actually components — converted to groups somewhere
3. Tokens aren't Variables — hardcoded values produce hardcoded output
4. Nesting is too deep — flatten to <5 levels per component
5. Auto Layout missing on containers — produces absolute-positioned output

### "The engineer is asking a question that's obviously answered in Figma"

Likely causes:
1. The answer isn't obvious — the naming or structure is unclear
2. The engineer didn't open Figma — they're working from a screenshot
3. The link points to the file root, not the specific frame

In all three cases, the designer shares responsibility. Fix the root cause, not just this instance.

### "The shipped version doesn't match the design"

Diagnose in this order:
1. Did the designer change the Figma file after handoff without telling the engineer?
2. Did the engineer use hardcoded values instead of tokens?
3. Did the engineer misinterpret ambiguous spec?
4. Was there a technical constraint that forced deviation?

Fix the process, not just the artifact. If #1, fix change management. If #2, fix the handoff contract. If #3, improve naming and structure. If #4, update the design to reflect the constraint.

### "Parity review keeps uncovering new issues every round"

This means the design wasn't ready at handoff time. Don't fix it in parity — that's 10x more expensive than fixing it in readiness. Go back to Stage 1.

### "We don't have time for all this process"

Scale the process to the stakes:
- **Trivial change** (copy update, single color tweak): Skip readiness, go straight to handoff note
- **Small feature** (new screen, existing components): Full pipeline, compressed
- **Large feature** (new component, multiple screens): Full pipeline, don't compress
- **Design system change**: Full pipeline + longer grace period + explicit announcement

The pipeline is a ceiling of rigor, not a floor. Use judgment.

---

## Priority Legend

- **[MUST]** — hard rule, violation breaks the handoff
- **[SHOULD]** — strong default, deviation requires documented reason
- **[MAY]** — optional, use judgment

## Relationship to Other Skills

- **figma-naming-conventions**: Governs the source file. This skill assumes it's applied.
- **Design Engineer skill** (if present): Governs code-side implementation patterns. This skill hands off to it at Stage 4.
- **a11y skill** (if present): Deeper WCAG guidance. This skill covers the handoff-integrated subset.

When rules conflict with figma-naming-conventions, naming conventions win for file-level concerns and this skill wins for process concerns.
