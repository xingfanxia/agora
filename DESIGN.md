<!-- Source: awesome-design-md / linear.app — https://github.com/VoltAgent/awesome-design-md -->
<!-- Adapted for Agora on 2026-04-16 — mint green accent (#22c493) swapped in for Linear's indigo-violet. -->

# Agora Design System

Built on **Linear's dark-mode-first foundation**, with Agora's mint green (`#22c493`) swapping in for Linear's indigo-violet as the single chromatic accent. Everything else — typography, spacing, borders, elevation philosophy — follows Linear's system because it's the strongest match for Agora's data-dense, multi-agent collaboration use case.

## 1. Visual Theme & Atmosphere

Agora is a **dark-mode-native** platform — a near-black canvas (`#08090a`) where multi-agent conversations emerge from darkness like starlight. This is not a dark theme applied to a light design — it is darkness as the native medium, where information density (agents, channels, phases, tokens, events) is managed through subtle gradations of white opacity rather than color variation.

Typography is built on **Inter Variable** with OpenType features `"cv01"` and `"ss03"` enabled globally — giving the typeface a cleaner, more geometric character. The signature weight is **510** (between regular and medium), creating subtle emphasis without shouting. Display sizes use aggressive negative letter-spacing (`-1.584px` at 72px, `-1.056px` at 48px) for that engineered-not-decorated feeling. **Berkeley Mono** (fallback: ui-monospace, SF Mono, Menlo) handles code and technical labels.

The color system is almost entirely **achromatic** — dark backgrounds with white/gray text — punctuated by a single brand accent: **Agora Mint** (`#22c493` for surfaces, `#2dd9a4` for interactive accents). This accent appears only on CTAs, active states, your-turn indicators, and brand moments. Borders are ultra-thin semi-transparent white (`rgba(255,255,255,0.05)` to `rgba(255,255,255,0.08)`) — wireframes drawn in moonlight.

**Key Characteristics:**
- Dark-mode-native: `#08090a` marketing background, `#0f1011` panel background, `#191a1b` elevated surfaces, `#28282c` hover
- Inter Variable with `"cv01", "ss03"` globally — geometric alternates for a cleaner aesthetic
- Signature weight 510 for most UI text; 400 for reading, 590 for strong emphasis
- Aggressive negative letter-spacing at display sizes
- Brand **Agora Mint**: `#22c493` (surface) / `#2dd9a4` (accent) / `#3fe4b0` (hover) — the only chromatic color
- Semi-transparent white borders throughout: `rgba(255,255,255,0.05)` to `rgba(255,255,255,0.08)`
- Button backgrounds at near-zero opacity: `rgba(255,255,255,0.02)` to `rgba(255,255,255,0.05)`
- Multi-layered shadows with inset variants for depth on dark surfaces
- Success green (`#27a644`, `#10b981`) reserved for status indicators (not brand)

## 2. Color Palette & Roles

### Background Surfaces
- **Deep Canvas** (`#08090a`): Landing, marketing, `/replay/[id]` hero — the darkest background. Near-pure black with an imperceptible cool undertone.
- **Panel Dark** (`#0f1011`): Sidebar (AppShell `<Sidebar>`), room-page chat column, observability dashboard panels.
- **Elevated Surface** (`#191a1b`): Card backgrounds (template cards, agent cards, team cards), dropdown menus, modal surfaces, turn panels.
- **Hover Surface** (`#28282c`): Hover states, slightly elevated components, button hover backgrounds.

### Text & Content
- **Primary Text** (`#f7f8f8`): Near-white with a barely-warm cast. Default text — not pure white, prevents eye strain on dark.
- **Secondary Text** (`#d0d6e0`): Cool silver-gray for body text, agent message content, descriptions.
- **Tertiary Text** (`#8a8f98`): Muted gray for placeholders, metadata, provider/model labels, de-emphasized content.
- **Quaternary Text** (`#62666d`): The most subdued text — timestamps, disabled states, subtle labels.

### Brand & Accent (Agora's swap from Linear's indigo)
- **Agora Mint** (`#22c493`): Primary brand color. Used on primary CTA button backgrounds, brand marks, the "Start Room" button, the landing hero accent.
- **Accent Mint** (`#2dd9a4`): Brighter variant for interactive elements — links, active nav items, "your turn" border, selected agent cards, human play indicator.
- **Accent Hover** (`#3fe4b0`): Lighter, more saturated variant for hover states on accent elements.
- **Mint Transparent** (`rgba(34, 196, 147, 0.08)`): Selected/active overlay for toggles, mode picker cards, human-seat dropdown selection.
- **Mint Ring** (`rgba(34, 196, 147, 0.3)`): Focus ring / selected card border.

### Status Colors
- **Live Green** (`#27a644`): Primary live/running indicator — the status dot on room status pills when `status === 'running'`.
- **Emerald** (`#10b981`): Secondary success — pill badges, completion states, verified states.
- **Waiting Amber** (`#f5a623`): Reserved for `status === 'waiting'` (human turn pending). Do NOT use for brand or accent.
- **Danger Red** (`#e74c3c`): Error states, elimination, destructive actions.

### Werewolf Role Semantics (mode-specific, not UI chrome)
These colors live ONLY inside game UI (role badges, night overlays). They do not appear in navigation, buttons, or general chrome:
- Werewolf role: `#b33030` (deep red) background with `#f7f8f8` text
- Seer role: `#5e8dc4` (cool blue) background
- Witch role: `#9b6fb3` (muted purple) background
- Guard role: `#5d8a5a` (sage green) background
- Hunter role: `#c8872d` (burnt orange) background
- Villager role: `#62666d` (neutral gray) background

Keep role colors inside the game view — the rest of the app is grayscale + mint.

### Border & Divider
- **Border Primary** (`#23252a`): Solid dark border for prominent separations.
- **Border Secondary** (`#34343a`): Slightly lighter solid border.
- **Border Subtle** (`rgba(255,255,255,0.05)`): Default — ultra-subtle semi-transparent border.
- **Border Standard** (`rgba(255,255,255,0.08)`): Standard border for cards, inputs, code blocks.
- **Line Tint** (`#141516`): Nearly invisible line for the subtlest divisions.

### Gradient System
- **Night Overlay** (werewolf-only): Linear gradient from `rgba(7, 8, 10, 0.6)` to `rgba(7, 8, 10, 0.9)` — only during werewolf night phases.
- **Mint Glow** (optional, CTA hover): Radial `rgba(34, 196, 147, 0.08)` spread — use sparingly, only on the landing page hero CTA.

## 3. Typography Rules

### Font Family
- **Primary**: `Inter Variable`, fallbacks: `SF Pro Display, -apple-system, system-ui, Segoe UI, Roboto, Helvetica Neue`
- **Chinese**: `PingFang SC, Hiragino Sans GB, Microsoft YaHei` (appended to Inter fallback stack for CJK)
- **Monospace**: `Berkeley Mono`, fallbacks: `ui-monospace, SF Mono, Menlo`
- **OpenType features**: `"cv01", "ss03"` enabled globally — non-negotiable. cv01 = single-story lowercase 'a'; ss03 = cleaner geometric forms.

### Hierarchy

| Role | Font | Size | Weight | Line Height | Letter Spacing | Notes |
|------|------|------|--------|-------------|----------------|-------|
| Display XL | Inter Variable | 72px (4.50rem) | 510 | 1.00 | -1.584px | Landing hero |
| Display Large | Inter Variable | 64px (4.00rem) | 510 | 1.00 | -1.408px | Section heroes |
| Display | Inter Variable | 48px (3.00rem) | 510 | 1.00 | -1.056px | Secondary heroes |
| Heading 1 | Inter Variable | 32px (2.00rem) | 400 | 1.13 | -0.704px | Page titles (`/teams`, `/agents`) |
| Heading 2 | Inter Variable | 24px (1.50rem) | 400 | 1.33 | -0.288px | Section headings |
| Heading 3 | Inter Variable | 20px (1.25rem) | 590 | 1.33 | -0.24px | Card titles, feature names |
| Body Large | Inter Variable | 18px (1.13rem) | 400 | 1.60 | -0.165px | Intro text, feature descriptions |
| Body Emphasis | Inter Variable | 17px (1.06rem) | 590 | 1.60 | normal | Emphasized body |
| Body | Inter Variable | 16px (1.00rem) | 400 | 1.50 | normal | Standard reading (agent messages) |
| Body Medium | Inter Variable | 16px (1.00rem) | 510 | 1.50 | normal | Navigation, buttons, labels |
| Small | Inter Variable | 15px (0.94rem) | 400 | 1.60 | -0.165px | Secondary body |
| Small Medium | Inter Variable | 15px (0.94rem) | 510 | 1.60 | -0.165px | Emphasized small text |
| Caption | Inter Variable | 13px (0.81rem) | 400–510 | 1.50 | -0.13px | Metadata (provider/model tags, timestamps) |
| Label | Inter Variable | 12px (0.75rem) | 400–590 | 1.40 | normal | Button text, small labels |
| Mono Body | Berkeley Mono | 14px (0.88rem) | 400 | 1.50 | normal | Code blocks, structured agent output |
| Mono Caption | Berkeley Mono | 13px (0.81rem) | 400 | 1.50 | normal | Event timeline entries |

### Principles
- **510 is the signature weight**: Use Inter Variable's 510 weight (between regular 400 and medium 500) as default emphasis — subtly bolded feel without the heaviness of traditional medium.
- **Compression at scale**: Display sizes use progressively tighter letter-spacing. Below 24px, spacing relaxes toward normal.
- **OpenType as identity**: `"cv01", "ss03"` aren't decorative — they transform Inter into Agora's distinctive typeface. Without them, it's generic Inter.
- **Three-tier weight system**: 400 (reading), 510 (emphasis/UI), 590 (strong emphasis). No 700/bold.
- **Relaxed body line-height**: Agent messages and reading text use 1.50–1.60 — more generous than typical dashboards. Prioritizes reading comfort for long conversations.

## 4. Component Stylings

### Buttons

**Primary Brand (Agora Mint)**
- Background: `#22c493` (Agora Mint)
- Text: `#ffffff` (or `#08090a` for extra contrast in accessible mode)
- Padding: 8px 16px
- Radius: 6px
- Hover: `#3fe4b0` background shift
- Use: "+ New Room", "Start Room", "Create Agent" — the single primary CTA per page

**Ghost Button (Default)**
- Background: `rgba(255,255,255,0.02)`
- Text: `#e2e4e7` (near-white)
- Border: `1px solid rgba(255,255,255,0.08)`
- Radius: 6px
- Hover: `rgba(255,255,255,0.04)` bg, border `rgba(255,255,255,0.12)`
- Use: Standard actions, secondary CTAs, edit/cancel

**Subtle Button**
- Background: `rgba(255,255,255,0.04)`
- Text: `#d0d6e0`
- Padding: 0px 6px
- Radius: 6px
- Use: Toolbar actions, channel filter dropdowns, contextual controls

**Icon Button (Circle)**
- Background: `rgba(255,255,255,0.03)` or `rgba(255,255,255,0.05)`
- Text: `#f7f8f8`
- Radius: 50%
- Border: `1px solid rgba(255,255,255,0.08)`
- Use: Close modals, language switcher, theme toggle

**Pill Button** (filters, status tags)
- Background: transparent
- Text: `#d0d6e0`
- Padding: 0px 10px
- Radius: 9999px
- Border: `1px solid #23252a`
- Active: `rgba(34, 196, 147, 0.08)` bg + `#22c493` border + `#2dd9a4` text
- Use: Channel filter chips, mode selector pills, advanced-rule toggles

### Cards & Containers (template cards, agent cards, team cards)
- Background: `rgba(255,255,255,0.02)` (never solid — always translucent over the surface below)
- Border: `1px solid rgba(255,255,255,0.08)` (standard) or `rgba(255,255,255,0.05)` (subtle)
- Radius: 8px (standard), 12px (featured template cards), 22px (large panels like the chat column)
- Hover: `rgba(255,255,255,0.04)` bg, border lightens to `rgba(255,255,255,0.12)`
- Shadow: usually none — borders carry the weight. Add `rgba(0,0,0,0.2) 0px 0px 0px 1px` for a crisp edge on elevated surfaces.

### Inputs & Forms

**Text Area** (agent wizard prompt, room topic, human speech input)
- Background: `rgba(255,255,255,0.02)`
- Text: `#f7f8f8`
- Placeholder: `#8a8f98`
- Border: `1px solid rgba(255,255,255,0.08)`
- Padding: 12px 14px
- Radius: 6px
- Focus: border `#22c493`, shadow `0 0 0 3px rgba(34, 196, 147, 0.15)`

**Dropdown Select** (Play-as dropdown, language switcher)
- Background: `rgba(255,255,255,0.02)`
- Text: `#f7f8f8`
- Padding: 8px 12px
- Radius: 6px
- Border: `1px solid rgba(255,255,255,0.08)`

### Badges & Pills

**Live Status Pill**
- Background: `rgba(39, 166, 68, 0.15)`
- Dot: `#27a644` (8px circle)
- Text: `#d0d6e0` "Live"
- Padding: 4px 10px
- Radius: 9999px
- Font: 12px weight 510

**Waiting Status Pill** (human turn pending)
- Background: `rgba(245, 166, 35, 0.15)`
- Dot: `#f5a623` (8px circle, pulsing)
- Text: `#d0d6e0` "Waiting"

**Human Seat Badge** (replaces provider badge on human-controlled agents)
- Background: `rgba(34, 196, 147, 0.15)`
- Text: `#2dd9a4` 🧑 "You"
- Padding: 2px 8px
- Radius: 4px
- Font: 11px weight 590

**Agent Provider Badge**
- Background: transparent
- Text: `#8a8f98`
- Content: e.g. `anthropic · claude-opus-4-7`
- Font: 13px weight 400
- Spacing: 1em between provider and model, separator `·` in `#62666d`

**Role Badge** (werewolf, inside room only)
- Background: role-specific (see §2)
- Text: `#f7f8f8`
- Icon + label
- Padding: 4px 10px
- Radius: 4px
- Font: 12px weight 510

### Navigation (AppShell Sidebar)
- Background: `#0f1011`
- Width: 220px desktop, 56px collapsed, off-canvas mobile
- Logo: Agora mark top-left
- Section headings: 11px weight 590 uppercase, `#62666d`, letter-spacing 0.08em
- Nav links: 14px weight 510, `#d0d6e0` default, `#f7f8f8` on hover
- Active link: `rgba(34, 196, 147, 0.08)` bg + `#2dd9a4` text + 3px left border `#22c493`
- "+ New Room" CTA: Primary brand button style, full-width in sidebar

### Chat Bubbles (agent messages)
- Background: `#191a1b` (elevated surface)
- Border: `1px solid rgba(255,255,255,0.08)`
- Radius: 12px
- Padding: 12px 16px
- Name label: 13px weight 590, color = agent's assigned color (from theme.ts palette) or `#f7f8f8`
- Timestamp: 11px weight 400, `#62666d`, above or beside name
- Content: 16px Inter, weight 400, `#d0d6e0`, line-height 1.60
- Human messages render IDENTICALLY to AI messages (no visual distinction — preserves Turing test + fairness)

## 5. Layout Principles

### Spacing System
- Base unit: 8px
- Scale: 4px, 8px, 12px, 16px, 20px, 24px, 32px, 40px, 48px, 64px, 80px
- Primary rhythm: 8px, 16px, 24px, 32px

### Grid & Container
- Max content width: 1200px (landing, `/teams`, `/agents`)
- Max form width: 820px (`/rooms/new`, `/agents/new`)
- Max room width: fluid (chat column 70% desktop, sidebar 30%)
- Hero: centered single-column with generous vertical padding (80px+)
- Feature grids: 2–3 columns responsive

### Whitespace Philosophy
- **Darkness as space**: On the dark canvas, empty space isn't white — it's absence. The near-black background IS the whitespace; content emerges from it.
- **Compressed headlines, expanded surroundings**: Display text at 48–72px with aggressive negative tracking is dense and compressed, but sits within generous dark padding. The tension between typographic density and spatial generosity is the aesthetic.
- **Section isolation**: Each section separated by 64–80px vertical padding with no visible dividers — the dark background provides natural separation.

### Border Radius Scale
- Micro (2px): Inline badges, toolbar buttons, subtle tags
- Standard (4px): Small containers, list items, role badges
- Comfortable (6px): Buttons, inputs, functional elements
- Card (8px): Template cards, agent cards, dropdowns
- Panel (12px): Chat bubbles, turn panels, featured cards
- Large (22px): Large panel elements, chat column wrapper
- Full Pill (9999px): Filter chips, status tags, user avatars at small sizes
- Circle (50%): Icon buttons, avatars, status dots

## 6. Depth & Elevation

| Level | Treatment | Use |
|-------|-----------|-----|
| Flat (Level 0) | No shadow, `#08090a` bg | Page background |
| Subtle (Level 1) | `rgba(0,0,0,0.03) 0px 1.2px 0px` | Toolbar buttons, micro-elevation |
| Surface (Level 2) | `rgba(255,255,255,0.02)` bg + `1px solid rgba(255,255,255,0.08)` border | Cards, input fields, containers |
| Inset (Level 2b) | `rgba(0,0,0,0.2) 0px 0px 12px inset` | Recessed panels (token inspector) |
| Ring (Level 3) | `rgba(0,0,0,0.2) 0px 0px 0px 1px` | Border-as-shadow crisp edge |
| Elevated (Level 4) | `rgba(0,0,0,0.4) 0px 2px 4px` | Floating elements, dropdowns |
| Dialog (Level 5) | Multi-layer: `rgba(0,0,0,0.04) 0px 3px 2px, rgba(0,0,0,0.07) 0px 1px 1px, rgba(0,0,0,0.08) 0px 0px 1px` | Modals, command palette |
| Focus (Interactive) | `0 0 0 3px rgba(34, 196, 147, 0.15)` + accent border | Focused inputs, keyboard nav on buttons |

**Shadow Philosophy**: On dark surfaces, traditional shadows (dark on dark) are nearly invisible. Use semi-transparent white borders as the primary depth indicator. Elevation is communicated through background luminance steps — each level slightly increases the white opacity (`0.02` → `0.04` → `0.05`), creating subtle stacking. The inset shadow technique creates the "sunken" effect for recessed panels.

## 7. Do's and Don'ts

### Do
- Use Inter Variable with `"cv01", "ss03"` on ALL text — fundamental to the typeface identity
- Use weight 510 as default emphasis weight — the signature between-weight
- Apply aggressive negative letter-spacing at display sizes
- Build on near-black backgrounds: `#08090a` deepest, `#0f1011` panels, `#191a1b` elevated
- Use semi-transparent white borders (`rgba(255,255,255,0.05)` to `0.08`) instead of solid dark borders
- Keep button backgrounds nearly transparent (`rgba(255,255,255,0.02)` to `0.05`) — except the primary mint CTA
- Reserve Agora Mint (`#22c493` / `#2dd9a4`) for primary CTAs, active states, and human-play indicators only
- Use `#f7f8f8` for primary text — not pure `#ffffff`
- Apply luminance stacking: deeper = darker bg, elevated = slightly lighter bg
- Render human messages identically to AI messages in chat (no visual distinction)

### Don't
- Don't use pure white (`#ffffff`) as primary text — `#f7f8f8` prevents eye strain
- Don't use solid colored backgrounds for buttons (except primary mint) — transparency is the system
- Don't apply mint decoratively — it's reserved for interactive/CTA elements only
- Don't use positive letter-spacing on display text — always runs negative at large sizes
- Don't use visible/opaque borders on dark backgrounds — borders should be whisper-thin semi-transparent white
- Don't skip the OpenType features (`"cv01", "ss03"`) — without them, it's generic Inter
- Don't use weight 700 (bold) — maximum is 590, with 510 as the workhorse
- Don't introduce warm colors into UI chrome (except werewolf role badges inside game view)
- Don't use drop shadows for elevation on dark surfaces — use background luminance stepping
- Don't add a "human" badge or distinct color to chat bubbles for human players — breaks game fairness

## 8. Responsive Behavior

### Breakpoints
| Name | Width | Key Changes |
|------|-------|-------------|
| Mobile Small | <600px | Single column, sidebar off-canvas |
| Mobile | 600–640px | Standard mobile, sidebar off-canvas |
| Tablet | 640–768px | Two-column grids begin, sidebar 56px collapsed |
| Desktop Small | 768–1024px | Full card grids, sidebar 220px |
| Desktop | 1024–1280px | Standard desktop, full navigation |
| Large Desktop | >1280px | Full layout, generous margins |

### Mobile specifics
- Display text: 72px → 48px → 32px, tracking adjusts proportionally
- Navigation: sidebar → off-canvas hamburger
- Feature grids: 3-col → 2-col → single column stacked
- Chat view: sidebar hidden by default, accessed via tab
- Turn panel (human play): full-width sticky bottom, above safe-area-inset

## 9. Agent Prompt Guide

### Quick Color Reference
- Primary CTA: **Agora Mint** (`#22c493`)
- Page Background: Deep Canvas (`#08090a`)
- Panel Background: Panel Dark (`#0f1011`)
- Surface: Elevated (`#191a1b`)
- Heading text: Primary White (`#f7f8f8`)
- Body text: Silver Gray (`#d0d6e0`)
- Muted text: Tertiary Gray (`#8a8f98`)
- Subtle text: Quaternary Gray (`#62666d`)
- Accent: Mint (`#2dd9a4`)
- Accent Hover: Light Mint (`#3fe4b0`)
- Border (default): `rgba(255,255,255,0.08)`
- Border (subtle): `rgba(255,255,255,0.05)`
- Focus ring: `0 0 0 3px rgba(34, 196, 147, 0.15)`
- Live status: `#27a644`
- Waiting status: `#f5a623`

### Example Component Prompts
- "Create a landing hero on `#08090a` background. Headline at 48px Inter Variable weight 510, line-height 1.00, letter-spacing -1.056px, color `#f7f8f8`, font-feature-settings `'cv01', 'ss03'`. Subtitle at 18px weight 400, line-height 1.60, color `#8a8f98`. Primary CTA: `#22c493` bg, `#ffffff` text, 6px radius, 8px 16px padding. Secondary ghost button: `rgba(255,255,255,0.02)` bg, `1px solid rgba(255,255,255,0.08)` border, 6px radius."
- "Design a template card on dark background: `rgba(255,255,255,0.02)` background, `1px solid rgba(255,255,255,0.08)` border, 12px radius, padding 20px. Title at 20px Inter Variable weight 590, letter-spacing -0.24px, color `#f7f8f8`. Description at 15px weight 400, color `#8a8f98`, letter-spacing -0.165px. Avatar stack (5 pixel-art avatars, 28px each, -8px overlap). Hover: bg to `rgba(255,255,255,0.04)`, border to `rgba(255,255,255,0.12)`."
- "Build an agent card listing: row with 40px circular pixel-art avatar, name at 16px weight 510, provider/model at 13px weight 400 color `#8a8f98` separated by `·`. Container: `rgba(255,255,255,0.02)` bg, `1px solid rgba(255,255,255,0.08)` border, 8px radius, 12px padding."
- "Create a human turn panel: fixed bottom, `#191a1b` bg, `border-top: 1px solid rgba(255,255,255,0.08)`, `border-left: 3px solid #22c493`. Header: 13px weight 590 color `#f7f8f8`. Textarea: `rgba(255,255,255,0.02)` bg, `1px solid rgba(255,255,255,0.08)` border, 6px radius, focus ring `0 0 0 3px rgba(34, 196, 147, 0.15)`. Submit button: `#22c493` bg, white text, 999px radius."
- "Design the sidebar navigation: `#0f1011` bg, 220px wide. Section headings: 11px weight 590 uppercase color `#62666d` letter-spacing 0.08em. Nav links: 14px weight 510 color `#d0d6e0`, hover `#f7f8f8`. Active: `rgba(34,196,147,0.08)` bg, `#2dd9a4` text, `3px solid #22c493` left border."

### Iteration Guide
1. Always set `font-feature-settings: "cv01", "ss03"` on all Inter text — non-negotiable
2. Letter-spacing scales with font size: -1.584px at 72px, -1.056px at 48px, -0.704px at 32px, normal below 16px
3. Three weights: 400 (read), 510 (emphasize/navigate), 590 (announce)
4. Surface elevation via background opacity: `rgba(255,255,255, 0.02 → 0.04 → 0.05)` — never solid bg on dark
5. Agora Mint (`#22c493` / `#2dd9a4`) is the only chromatic color outside game-mode views
6. Borders always semi-transparent white on dark backgrounds, never solid dark colors
7. Human play indicators use mint, not a separate color
8. Werewolf role colors (red/blue/purple/green/orange) appear ONLY inside `/room/[id]` for werewolf rooms — never in nav, settings, or other chrome

---

## Agora-Specific Extensions

### Agent Color Palette (for chat bubble names)
The existing `theme.ts` assigns one of 8 colors per agent position for name labels in chat. These are warm/cool variants chosen for readability on dark surfaces. They are NOT brand colors — they're content-attribution colors, similar to syntax highlighting. Keep the existing palette.

### Werewolf Night Mode
During werewolf night phases, the chat area gets a subtle overlay: `linear-gradient(to bottom, rgba(7,8,10,0.6), rgba(7,8,10,0.9))` applied to the chat container. The HUD and turn panel remain visible through the overlay. Don't change any brand colors during night mode — only the chat background.

### DiceBear Pixel Avatars
Agent avatars use DiceBear pixel-art. Keep the pixelated image rendering (`imageRendering: 'pixelated'`), 8-bit-style. Avatar seed is stored per-agent for stable identity. Don't override with smooth interpolation.

### Language (zh + en)
PingFang SC is the CJK companion to Inter. When text is primarily Chinese, weight perception shifts — weight 510 can feel lighter in zh. Bump to 590 for equivalent visual weight in Chinese UI labels. Inter handles Latin characters; PingFang handles CJK. Don't force a single font.
