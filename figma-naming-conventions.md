---
name: figma-naming-conventions
description: Use this skill whenever working in Figma files where the output will be handed off to frontend engineers or consumed by Figma MCP / Code Connect. Covers naming rules for components, layers, variables, styles, frames, and assets, plus file and page structure conventions. Use when creating new components, auditing existing files, preparing a design system library, reviewing a file before handoff, or troubleshooting why Figma MCP returns poor code output. Do NOT use this skill for pure visual design critique, user research, or tasks unrelated to Figma file hygiene.
---

# Figma Naming Conventions

A strict naming and structure specification for Figma files intended for frontend handoff and Figma MCP / Code Connect consumption. Optimized for cross-stack design token export.

## Core Principles

**[MUST] Semantic over visual.** Name things by what they are, not how they look. `color/bg/primary` not `color/blue-500`. `Button/Danger` not `Button/Red`.

**[MUST] Consistency over perfection.** Any convention followed 100% beats a "better" convention followed 80%. When in doubt, match existing patterns in the file.

**[MUST] Layer structure mirrors DOM/component tree.** Every frame, auto layout, and group should correspond to something a frontend engineer would actually write. If a wrapper exists only for visual spacing, use padding instead.

**[MUST] ASCII only.** No CJK characters, emoji (except in Page names — see below), or special characters in component, layer, variable, or style names. Figma MCP, Code Connect, and most codegen tools are fragile with non-ASCII.

**[MUST] No default names.** `Frame 1247`, `Rectangle 12`, `Group 3 copy` are forbidden. If a layer doesn't deserve a name, it shouldn't exist as a separate layer.

---

## Naming Format Rules

| Element type | Format | Example | Notes |
|---|---|---|---|
| Component | `PascalCase/PascalCase` | `Button/Primary` | Slash creates variant grouping |
| Component Set variant | `PascalCase` | `Size=Large, State=Hover` | Property values are PascalCase |
| Component Property | `camelCase` | `isDisabled`, `hasIcon`, `label` | Must match React prop conventions |
| Layer (frame/instance) | `kebab-case` | `nav-primary`, `hero-image` | Directly usable as className |
| Variable | `category/subcategory/name` | `color/bg/primary` | Lowercase, slash-separated |
| Variable Collection | `PascalCase` | `Primitives`, `Semantic` | See Collections section |
| Style (legacy) | `Category/Name` | `Heading/H1` | Only when variables can't be used |
| Page | `<emoji> Name` | `🧱 Components` | Emoji allowed here only |
| Asset export | `kebab-case` | `icon-arrow-right` | Matches code import path |

**[MUST NOT]** mix separators. Pick `/` for hierarchy and `-` for word separation. Never `_`, never spaces, never camelCase in layer names.

---

## Component Naming

### Structure

```
<Category>/<ComponentName>/<Variant?>
```

**Examples:**
- `Button/Primary`
- `Button/Secondary`
- `Card/Product`
- `Input/Text`
- `Input/Select`
- `Icon/ArrowRight`

**[MUST]** Use Component Set + variant properties instead of slash-separated variants whenever the variations are dimensional (size × state × type). Slashes are only for true category grouping.

**Wrong:**
```
Button/Primary/Large/Hover
Button/Primary/Large/Default
Button/Primary/Small/Hover
```

**Right:** One `Button/Primary` component set with properties `size` (sm/md/lg) and `state` (default/hover/active/disabled).

### Component Properties

**[MUST]** Use camelCase matching frontend prop conventions:
- Boolean: `isDisabled`, `hasIcon`, `isLoading`, `showBadge`
- Text: `label`, `placeholder`, `helperText`
- Instance swap: `leadingIcon`, `trailingIcon`, `avatar`
- Variant: `size`, `variant`, `state`, `tone`

**[MUST NOT]** use human-readable names like `"Has Icon"`, `"Show Badge?"`, `"Button Text"` — these require manual mapping in Code Connect.

### Variant Property Order

**[MUST]** Order variant properties semantically, not by state:
1. Type/variant (what it fundamentally is)
2. Size
3. State (interactive)
4. Modifier flags

**Right:** `variant=primary, size=md, state=hover, hasIcon=true`
**Wrong:** `state=hover, hasIcon=true, size=md, variant=primary`

### Component Description

**[MUST]** Every main component's description field contains:
1. One-line purpose
2. Code path (e.g., `@/components/ui/Button`)
3. Link to Storybook/docs if exists

Example:
```
Primary action button. Use for the single most important action per view.
Code: @/components/ui/Button
Docs: https://storybook.company.com/button
```

---

## Layer Naming

### Rules

**[MUST]** Use kebab-case. The name should be directly usable as a CSS class or data attribute.

**[MUST]** Name describes semantic role, not position:
- ✅ `product-grid`, `filter-sidebar`, `checkout-summary`
- ❌ `left-column`, `top-section`, `right-box`

**[SHOULD]** Prefix interactive elements to survive codegen:
- `btn-*` for buttons
- `link-*` for links
- `input-*` for form fields
- `card-*` for cards

**[MUST]** Text layers carry semantic role:
- `heading-1` through `heading-6` → maps to `<h1>`–`<h6>`
- `body`, `body-sm`, `body-lg` → maps to `<p>`
- `caption`, `label`, `overline` → maps to smaller text elements

Figma MCP uses these names to infer HTML semantics. `Text` alone produces `<div>`.

### Auto Layout Naming

**[SHOULD]** Express layout intent when it matters for codegen:
- `row-between`, `row-start`, `row-center`
- `stack-start`, `stack-center`
- `grid-2col`, `grid-3col`, `grid-auto`

Not required for every frame — only when the layout is non-obvious or reused.

### Forbidden Layer Names

- `Frame N`, `Rectangle N`, `Group N` (Figma defaults)
- `copy`, `copy 2`, ` copy` suffix
- `new`, `final`, `v2`, `old` (use versioning, not names)
- `asdf`, `test`, `xxx` (scratch names)
- Any name ending in a trailing space

---

## Variable (Token) Naming

### Collections

**[MUST]** Organize variables into three collections:

1. **`Primitives`** — Raw values. Never referenced directly by components.
   - `color/blue/500`, `color/gray/900`
   - `size/4`, `size/8`, `size/16`
   - `font/family/sans`

2. **`Semantic`** — Meaning-based tokens that reference primitives. This is what components use.
   - `color/bg/primary` → `Primitives/color/blue/500`
   - `color/text/default` → `Primitives/color/gray/900`
   - `space/md` → `Primitives/size/16`

3. **`Component`** — Component-specific tokens that reference semantic. Optional, use sparingly.
   - `button/primary/bg` → `Semantic/color/bg/primary`
   - `card/shadow` → `Semantic/elevation/md`

**[MUST NOT]** Reference primitives directly from components. Always go through semantic layer. This is what makes dark mode, theming, and white-labeling possible.

### Variable Name Structure

```
<category>/<subcategory>/<name>[/<modifier>]
```

**Categories (fixed list):**
- `color` — all color tokens
- `space` — padding, margin, gap (never hardcode px)
- `size` — width, height, icon sizes
- `radius` — border radius
- `border` — border widths
- `font` — family, size, weight, line-height, letter-spacing
- `elevation` — shadows
- `opacity` — alpha values
- `duration` — animation timing
- `easing` — animation curves
- `z` — z-index layers
- `breakpoint` — responsive breakpoints

**Color subcategories (fixed):**
- `bg` — backgrounds
- `text` — foreground text
- `border` — borders and dividers
- `icon` — icon fills
- `accent` — brand accents

**Examples:**
```
color/bg/primary
color/bg/primary/hover
color/text/default
color/text/muted
color/text/on-primary        ← text color when placed on bg/primary
color/border/default
color/icon/accent
space/xs, space/sm, space/md, space/lg, space/xl, space/2xl
radius/sm, radius/md, radius/lg, radius/full
font/family/sans
font/size/body
font/weight/semibold
elevation/sm, elevation/md, elevation/lg
```

### T-shirt Sizes vs. Numeric Scales

**[SHOULD]** Use t-shirt sizes (`xs`/`sm`/`md`/`lg`/`xl`) for semantic tokens. Easier to reason about, stable across refactors.

**[SHOULD]** Use numeric (`100`/`200`/`300`) for primitive color ramps. Matches industry convention.

### Modes

**[MUST]** Fixed mode names across collections:
- Theme: `Light`, `Dark`
- Density: `Comfortable`, `Compact`
- Language (if applicable): ISO codes — `en`, `zh`, `ja`

**[MUST NOT]** Invent mode names like `"Default"`, `"Alternative"`, `"Theme 2"`.

---

## Frame & Screen Naming

### Screens

**[MUST]** Screen frames use format: `[Status] FeatureName / ScreenName / Breakpoint`

```
[Ready] Checkout / Payment / Desktop
[Ready] Checkout / Payment / Mobile
[WIP] Checkout / Confirmation / Desktop
[Review] Profile / Settings / Desktop
```

**Status tags:**
- `[WIP]` — work in progress, do not implement
- `[Review]` — ready for design review
- `[Ready]` — approved, ready for dev handoff
- `[Shipped]` — in production
- `[Deprecated]` — pending removal

**[MUST]** Frontend only implements `[Ready]` and `[Shipped]` frames.

### Breakpoints

**[MUST]** Breakpoint suffix matches variable names exactly:
- `Mobile` (≤ `breakpoint/sm`)
- `Tablet` (`breakpoint/md`)
- `Desktop` (`breakpoint/lg`)
- `Wide` (`breakpoint/xl`)

---

## Page Structure

**[MUST]** Every file has these pages in this order:

```
📘 Cover                  ← File description, version, contacts
📖 README                 ← Changelog, conventions, known issues
🎨 Tokens                 ← Variable documentation
🧱 Components             ← Component library
🧩 Patterns               ← Composed patterns (forms, lists)
📱 Screens - <Feature>    ← One page per feature area
🗂 Archive                ← Deprecated content
🚧 WIP                    ← Active exploration
```

**[MUST]** Emoji prefix for visual scanning in the sidebar. This is the only place emoji are allowed.

**[MUST NOT]** mix components and screens on the same page.

---

## Asset Export Naming

**[MUST]** Layer name = exported filename. No frame path prefix.

- Layer `icon-arrow-right` → file `icon-arrow-right.svg`
- Layer `illustration-empty-state` → `illustration-empty-state.png`

**[MUST]** Icons follow format: `icon-<name>`
**[MUST]** Illustrations follow format: `illustration-<name>`
**[MUST]** Photos follow format: `photo-<subject>`
**[MUST]** Logos follow format: `logo-<brand>` or `logo-<brand>-<variant>`

**[MUST]** Icon SVGs use a single color fill bound to a variable, so they export as `currentColor`-compatible. Multi-color icons must be explicitly named `icon-<name>-multicolor`.

---

## MCP & Code Connect Optimizations

This section is the reason most of the above rules exist. Follow these to get usable output from Figma MCP.

**[MUST]** Layer names survive to codegen as className/data-testid. Garbage in, garbage out.

**[MUST]** Component Property names match frontend prop names exactly. If the React component uses `isDisabled`, the Figma property must also be `isDisabled` — not `Disabled`, not `is-disabled`, not `Is Disabled`.

**[MUST]** Every design token referenced by a component must be a Variable, not a hardcoded value or legacy Style. MCP returns hardcoded hex values for unbound fills, which forces frontend to re-tokenize manually.

**[MUST]** Auto Layout for every container that has children. MCP generates absolute-positioned garbage from plain Groups and Frames without Auto Layout.

**[SHOULD]** Cap nesting depth at 5 levels within a single component. Deeper trees produce div soup that's hard to maintain.

**[SHOULD]** Cap instance count per screen frame at ~200. Beyond that, MCP responses hit token limits and truncate.

**[MUST NOT]** Detach instances. Detached instances lose component linkage and MCP can only return raw geometry. If a variant is missing, add it to the main component instead.

**[MUST]** Main components live in the `🧱 Components` page. Instances referenced from screens must resolve to that page, not to another screen.

---

## Anti-Patterns (Forbidden)

These are hard rejections during review:

- ❌ Default Figma names (`Frame 123`, `Rectangle 4 copy`)
- ❌ CJK or emoji in layer/component/variable names (emoji OK only in Page names)
- ❌ Hardcoded colors, spacing, or radii (everything through variables)
- ❌ Groups instead of Frames (no Auto Layout = absolute positioning in codegen)
- ❌ Detached instances
- ❌ Text layers named `Text`, `Text 2`, etc.
- ❌ Fixed-width text layers (breaks i18n and responsive)
- ❌ Rectangle + Text hand-assembled instead of Button component
- ❌ Component without description
- ❌ Instance with uncontrolled overrides (override must flow through a variant property)
- ❌ Multiple components for the same visual (`Button/Primary` and `PrimaryButton` coexisting)
- ❌ Main component in a screen page instead of Components page
- ❌ Mixed separators (`Button-Primary` and `Button/Primary` in the same file)
- ❌ Absolute-positioned children inside a component (except badges/tooltips/popovers)
- ❌ Variable referenced from a component that points directly to a Primitive (must go through Semantic)
- ❌ Component Property using spaces or non-camelCase

---

## Pre-Handoff Checklist

Before marking a frame `[Ready]`:

1. ☐ No layers with default names
2. ☐ All text layers have semantic role names (`heading-N`, `body`, `caption`)
3. ☐ All interactive elements use component instances, not hand-assembled shapes
4. ☐ All colors, spacing, radii reference Variables
5. ☐ All frames that contain children use Auto Layout
6. ☐ No detached instances
7. ☐ Component Property names are camelCase
8. ☐ Nesting depth ≤ 5 within any single component
9. ☐ All exported assets have kebab-case names matching their usage
10. ☐ Dark mode renders correctly (if applicable)
11. ☐ Frame title includes status tag and breakpoint
12. ☐ Main components linked from the Components page, not local copies

---

## Worked Example

**Scenario:** A product card with image, title, price, and an add-to-cart button.

### Component structure

```
Components page
└── Card/Product  (component set)
    ├── Property: size (sm, md, lg)
    ├── Property: hasDiscount (boolean)
    ├── Property: isOutOfStock (boolean)
    └── Layer tree:
        card-product (auto layout, stack-start)
        ├── card-product__media (auto layout)
        │   └── image-placeholder
        ├── card-product__body (auto layout, stack-start)
        │   ├── heading-3  ← product title
        │   ├── card-product__price-row (auto layout, row-between)
        │   │   ├── body   ← current price
        │   │   └── caption ← original price (shown when hasDiscount)
        │   └── Button/Primary  (instance, size=sm)
        └── badge-out-of-stock  (shown when isOutOfStock)
```

### Variables used

```
color/bg/surface          ← card background
color/text/default        ← title
color/text/accent         ← price
color/text/muted          ← original price
space/md                  ← internal padding
space/sm                  ← gap between rows
radius/lg                 ← card corner
elevation/sm              ← card shadow
```

### Description field

```
Product card for grid and list views. Handles out-of-stock and discount states.
Code: @/components/product/ProductCard
Docs: https://storybook.company.com/product-card
```

---

## Priority Legend

- **[MUST]** — hard rule, violation blocks handoff
- **[SHOULD]** — strong default, deviation requires documented reason
- **[MAY]** — optional, use judgment

When rules conflict, the stricter rule wins. When MCP output quality conflicts with human readability, MCP wins — engineers read code, not Figma.
