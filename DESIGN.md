# Design System — Manu (VPA Petition Desk)

> Read this file before making any visual or UI decision. All colors, fonts,
> spacing, icons, and aesthetic direction are defined here. Do not deviate
> without explicit user approval. In QA, flag any code that does not match this file.

Direction: **Civic Slate**. Established via `/design-consultation`, 2026-07-03.

---

## Product Context

- **What this is:** A petition / grievance intake and case-management system for a
  Tamil Nadu minister's office (initially the Education Minister). Citizens submit
  petitions; PA staff triage, ticket, and resolve them.
- **Who it's for:** Two audiences. (1) Citizens, often older, low-digital-literacy,
  Tamil-first, submitting once at a venue on a phone. (2) PA staff, trained, using
  the portal all day.
- **North star (memorable feeling):** *Efficient and serious.* Confident
  institutional competence. On the citizen side, "efficient" means zero-friction and
  respectful of their time, never dense or intimidating. Serious must never become
  cold or hard to use.
- **Three surfaces, one brand:**
  1. **Citizen intake** (Jinja2: `form`, `qr_display`, `referral_form`, `success`) —
     mobile-first, generous, one action per screen, Tamil-first.
  2. **PA portal** (Next.js + shadcn/ui + Tailwind) — data-dense, scannable, efficient.
  3. **Display board** (PWA) — glanceable from across a room, oversized type.

---

## Aesthetic Direction

- **Direction:** Civic Slate. Cool, systematic, modern digital-government. Flat
  surfaces, sharp corners, high contrast. Function first, zero decoration.
- **Decoration level:** Minimal. Typography and spacing do the work.
- **Mood:** Calm, official, competent, engineered. Cool-toned and precise.
- **Note:** Elegant serif headlines (see Typography) sit over the cool slate chrome,
  which keeps Civic Slate refined rather than cold-corporate. No decorative motifs.

---

## Typography

Bilingual Tamil + English is a hard constraint. Never bolt a Tamil font onto a
Latin-only stack. Every text-bearing font stack lists a Latin face first and a
matching Tamil face second, so Latin glyphs render from the Latin font and Tamil
glyphs fall through to the paired Tamil font automatically.

**Two-tier system:** an elegant serif for headlines and long-form reading, a warm
humanist sans for UI and dense working surfaces.

- **Headlines + long-form reading (serif):** **Fraunces** (Latin) + **Noto Serif
  Tamil** (Tamil). Display text, page/section titles, case headlines, and the
  citizen's grievance summary body, where reading comfort and gravitas matter most.
- **UI + body + dense areas (sans):** **Catamaran** (Latin + Tamil, one family).
  PA portal, tables, forms, labels, buttons, all working surfaces. Warm, humanist,
  highly readable in Tamil.
- **All numbers (mono):** **IBM Plex Mono** (400/500/600/700), tabular figures. Every
  numeric value renders in mono: counts, dates, times, amounts, phone numbers, token
  numbers (`TKN2026070200017`), ticket numbers (`TKT-2026-00042`). Catamaran's soft
  proportional digits are not used for data. Mechanism: the `tabular-nums` utility is
  mapped to the mono family app-wide in `globals.css`; use `.num` for any number not
  already tagged. An explicit `font-*` utility still wins where mixed text needs it.
- **Never:** Inter, Roboto, Poppins, system-ui as display/body.

### Font stacks

```
--font-serif: 'Fraunces', 'Noto Serif Tamil', Georgia, serif;   /* headlines, long reading */
--font-sans:  'Catamaran', system-ui, sans-serif;               /* UI, body, dense (covers both scripts) */
--font-mono:  'IBM Plex Mono', ui-monospace, monospace;         /* IDs, tokens, numbers */
```

### Type scale (PA portal / default density)

| Role        | Family | Size            | Weight | Line height | Tracking | Notes |
|-------------|--------|-----------------|--------|-------------|----------|-------|
| Display     | serif  | 32px / 2rem     | 600    | 1.1         | -0.01em  | Hero, page titles |
| H1          | serif  | 26px / 1.625rem | 600    | 1.15        | -0.01em  | Section titles, case headlines |
| H2          | serif  | 20px / 1.25rem  | 600    | 1.3         | 0        | Card titles |
| H3          | sans   | 16px / 1rem     | 600    | 1.3         | 0        | Sub-heads |
| Reading     | serif  | 15px            | 400    | 1.7         | 0        | Long grievance text. Tamil → 1.9 |
| Body        | sans   | 14px / 0.875rem | 400    | 1.6         | 0        | UI body. Tamil → 1.85 |
| Small/meta  | sans   | 12px / 0.75rem  | 500    | 1.4         | 0        | Muted metadata |
| Label/micro | sans   | 11px            | 600    | 1.35        | 0.09em   | UPPERCASE section labels |
| Mono/ID     | mono   | 13px            | 500-600| 1.4         | 0.01em   | Tabular figures |

**Tamil needs more vertical room.** Catamaran (sans) Tamil body → line height ~1.85;
Noto Serif Tamil reading → ~1.9. Never letter-space Tamil. Bump one step on the
citizen surface (base body 16px, buttons 15-16px).

### Loading

- **Next.js (PA portal):** `next/font/google` for `Fraunces`, `Noto_Serif_Tamil`,
  `Catamaran`, `IBM_Plex_Mono`. Expose as CSS variables and wire into Tailwind.
- **Jinja2 (citizen + display):** add to `<head>`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Catamaran:wght@400;500;600;700;800&family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Noto+Serif+Tamil:wght@400;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
```

---

## Color

Approach: **restrained, cool**. One slate primary, one bright signal-blue for the
key action, blue-tinted neutrals, and a functional urgency scale. Urgency/status
colors are semantic and stable, they do not change with brand.

### Brand + neutrals (light, default)

| Token | Hex | Usage |
|-------|-----|-------|
| Slate Indigo (primary) | `#21395B` | Headers, default/system buttons, active nav |
| Signal Blue (accent)   | `#2F6FED` | The ONE primary action per screen, focus ring, active state |
| Signal foreground      | `#FFFFFF` | Text/icon on signal-blue fill |
| Paper (background)      | `#F3F5F8` | App background (cool) |
| Surface / card         | `#FFFFFF` | Cards, panels, inputs |
| Ink (foreground)       | `#131720` | Primary text |
| Muted foreground       | `#5A6472` | Secondary text, metadata |
| Muted surface          | `#EAEEF3` | Subtle fills, hover rows |
| Border / input         | `#E1E5EB` | Hairline borders, dividers |

### Urgency scale (structural — drives triage)

| Level | Hex | On-color text |
|-------|-----|---------------|
| Critical | `#B2372D` | `#FFFFFF` |
| High     | `#CC6A1F` | `#FFFFFF` |
| Medium   | `#C9A227` | `#2A2205` |
| Low      | `#4F8A5B` | `#FFFFFF` |

Maps directly to `grievance_summary` urgency (`critical/high/medium/low`).

### Status / semantic

| Token | Hex |
|-------|-----|
| success | `#2E7D5B` |
| warning | `#C9A227` |
| error   | `#B2372D` |
| info    | `#2C6E7A` |

### Accent discipline

- **Slate Indigo** = system/default actions (secondary buttons, active nav, chrome).
- **Signal Blue** = exactly one primary action per screen, plus focus/active state.
  It is the "go here" color. Overusing it flattens the hierarchy.
- Signal Blue and the urgency scale never share meaning: signal is an action, urgency
  is a triage state. Keep them visually separate in any one component.

### Dark mode (PA portal, optional, for all-day staff use)

Redesign surfaces, do not just invert. Reduce saturation ~10-15%.

```
--background:#0E1420; --surface:#161E2E; --foreground:#E7ECF4;
--muted-foreground:#93A0B5; --border:#26304200;
--primary:#3E5C8A;      --primary-foreground:#0A0F18;   /* lightened slate */
--accent:#5B8CFF;       --accent-foreground:#08101F;    /* lightened signal blue */
/* urgency stays semantic; lighten ~8% for contrast on dark */
```

---

## Spacing

- **Base unit:** 4px.
- **Scale:** `2 · 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64`.
- **Density modes:**
  - **Compact** (PA portal): table rows ~8-11px vertical padding, tight gaps.
  - **Comfortable** (citizen): 12-16px padding, 16-24px gaps, roomy.
  - **Spacious** (display board): oversized padding, big rhythm.

---

## Layout

- **Approach:** grid-disciplined.
- **PA portal:** 12-column, max content width ~1440px, dense tables, sticky filters.
- **Citizen intake:** single column, max width ~480-560px, one action per screen,
  **minimum 48px touch targets**, labels above inputs, Tamil label first / English second.
- **Display board:** 2-3 oversized rows, huge token numbers, readable from ~5m.
- **Border radius:** input/chip `4px`, button/card `6px`, panel/modal `8px`,
  urgency pill `9999px`. Sharp-ish, never bubbly.

---

## Motion

- **Approach:** minimal-functional. No choreography, no bounce.
- **Duration:** micro 150ms, standard 200ms, modal 250ms.
- **Easing:** enter `ease-out`, exit `ease-in`, move `ease-in-out`.

---

## Icons

- **Library:** `lucide-react` (already installed). Standardize on it everywhere.
- **Stroke:** 1.75px. **Sizes:** 16px (dense), 20px (default), 24px (touch).
- **Never filled** except small status dots.
- **Citizen surface:** always pair an icon with a text label. Older users read text
  faster than glyphs. Never rely on an icon alone to convey an action.

---

## Ready-to-paste tokens

`:root` for the citizen/Jinja2 CSS and as the source of truth for the shadcn variables.

```css
:root {
  --font-serif: 'Fraunces','Noto Serif Tamil',Georgia,serif;
  --font-sans:  'Catamaran',system-ui,sans-serif;
  --font-mono:  'IBM Plex Mono',ui-monospace,monospace;

  --background:#F3F5F8;  --foreground:#131720;
  --surface:#FFFFFF;     --surface-foreground:#131720;
  --primary:#21395B;     --primary-foreground:#FFFFFF;
  --accent:#2F6FED;      --accent-foreground:#FFFFFF;
  --muted:#EAEEF3;       --muted-foreground:#5A6472;
  --border:#E1E5EB;      --input:#E1E5EB;  --ring:#2F6FED;

  --urgency-critical:#B2372D; --urgency-high:#CC6A1F;
  --urgency-medium:#C9A227;   --urgency-low:#4F8A5B;

  --success:#2E7D5B; --warning:#C9A227; --error:#B2372D; --info:#2C6E7A;

  --radius-sm:4px; --radius:6px; --radius-lg:8px;
}
```

Tailwind (`tailwind.config.ts`) `theme.extend`:

```ts
fontFamily: {
  serif: ['Fraunces','Noto Serif Tamil','Georgia','serif'],
  sans:  ['Catamaran','system-ui','sans-serif'],
  mono:  ['IBM Plex Mono','ui-monospace','monospace'],
},
colors: {
  urgency: { critical:'#B2372D', high:'#CC6A1F', medium:'#C9A227', low:'#4F8A5B' },
},
```

---

## Accessibility

- Body text on Paper/Surface meets WCAG AA. Slate Indigo and Ink on white are AAA.
- Signal Blue (`#2F6FED`) has white foreground; passes AA for buttons/large text.
- Tamil line height minimum 1.7. Never letter-space Tamil.
- Citizen touch targets minimum 48px. Focus ring uses `--ring` (Signal Blue), 2px, visible.
- Urgency is never conveyed by color alone. Always pair with a label or icon.

---

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-07-03 | Locked direction: **Civic Slate** | `/design-consultation`. North star "efficient and serious". Chosen over Institutional Modern and Monograph after comparing all three on the live portal. |
| 2026-07-03 | Primary Slate Indigo `#21395B` + Signal Blue `#2F6FED` accent | Cool, systematic digital-government feel. Signal blue for the one key action. Non-partisan. |
| 2026-07-03 | Type: Fraunces + Noto Serif Tamil (headlines/reading) over Catamaran (UI/body) | Elegant serif for beautiful reading, humanist sans for efficient dense work. Kept when switching to Civic Slate (originally spec'd IBM Plex Sans) to preserve the elegant-reading goal. |
| 2026-07-03 | Urgency scale is semantic and brand-independent | Triage colors stayed stable through all three direction changes. |
| 2026-07-03 | Keep lucide-react icons | Already installed, matches the efficient/serious icon language. |
