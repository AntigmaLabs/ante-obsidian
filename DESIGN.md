# Design System: Ante md

## 1. Visual Theme & Atmosphere

Ante md should feel like a quiet agent workspace embedded inside Obsidian, not a glossy SaaS app and not a standalone terminal emulator. The interface is for reading, diffing, approving, and applying Markdown changes with confidence. The visual language should combine editorial calm with developer-tool precision.

The product tone is:

- restrained
- technical
- note-aware
- high-trust
- dense without feeling cramped

The primary spatial metaphor is a split workspace:

- left rail for conversation history and navigation
- central reading pane for assistant output and diffs
- anchored composer or command surface at the bottom

The interface should feel native to Obsidian first. Custom styling should extend host theme variables instead of fighting them. The plugin should inherit the user theme gracefully in both light and dark modes.

## 2. Color Palette & Roles

Use Obsidian theme tokens as the substrate, then derive a small set of semantic Ante md tokens.

### Host-First Base

- `var(--background-primary)`: main paper surfaces
- `var(--background-secondary)`: side panels and grouped surfaces
- `var(--background-modifier-border)`: dividers and control outlines
- `var(--background-modifier-hover)`: hover and active wash
- `var(--text-normal)`: primary reading text
- `var(--text-muted)`: metadata, timestamps, helper copy
- `var(--text-accent)`: links and subtle emphasis
- `var(--interactive-accent)`: active controls, selected context, focus accents

### Ante md Semantic Roles

- `terminal bg`: deep neutral with slight blue cast, used only for terminal surfaces
- `workspace paper`: lightly tinted paper for chat and settings
- `workspace panel`: slightly denser panel tone for sidebars and grouped rows
- `workspace line`: soft divider line, never harsh 1-bit black
- `user message`: low-chroma accent wash derived from `--interactive-accent`
- `assistant message`: nearly paper-colored, optimized for long-form reading
- `diff add`: green with enough tint to remain legible on host themes
- `diff remove`: red with enough tint to remain legible on host themes
- `warning / approval`: warm amber, clearly separate from destructive red

### Color Principles

- Never use pure black or pure white.
- Avoid decorative gradients unless they reinforce a surface transition.
- Accent should be sparse and functional.
- User and assistant messages should differ by structure and tone, not by loud colors.
- Diff and approval states should be the most visually explicit elements.

## 3. Typography Rules

Typography should privilege reading and scanning over branding.

### Font Roles

- `Primary UI`: Obsidian text font via `var(--font-text)`
- `Monospace`: Obsidian mono font via `var(--font-monospace)`

### Hierarchy

| Role | Size | Weight | Line Height | Notes |
|---|---:|---:|---:|---|
| Workspace title | 1.08rem-1.16rem | 700 | 1.25 | Tight, compact, no decorative flourish |
| Section title | 0.98rem-1rem | 600-700 | 1.3 | Settings groups, cards, update blocks |
| Body UI | 0.96rem-1rem | 400-500 | 1.5-1.6 | Controls, labels, short descriptions |
| Reading body | 1.02rem-1.06rem | 400 | 1.68-1.76 | Assistant markdown output |
| Meta / kicker | 0.72rem-0.84rem | 600-700 | 1.35-1.45 | Timestamps, context labels, status copy |
| Mono small | 12px-13px | 500 | 1.45-1.55 | Terminal chrome, diff gutters, process logs |

### Typography Principles

- Use uppercase only for tiny labels, chrome copy, and status markers.
- Reading text should breathe more than control text.
- Metadata should be quieter by color and scale, not by becoming illegible.
- Assistant output should feel like a reading surface, not a chat bubble toy UI.

## 4. Component Stylings

### Chat Shell

- Rounded outer shell with subtle internal separation between rail and main pane
- Left rail should feel like a tool navigator, not a social messaging app
- Collapsed state should become an icon rail, not a broken narrow sidebar

### Conversation Rows

- Compact, list-like, strong hover clarity
- Active row should be indicated by a quiet accent wash plus a thin structural marker
- Secondary destructive action should stay hidden until hover or focus

### Message Presentation

- User messages may use a contained bubble with a softened accent tint
- Assistant messages should be flatter and wider, optimized for markdown reading
- Timestamps and roles must remain visible but understated
- Long assistant responses should visually connect to tools, diffs, approvals, and logs below

### Composer

- Composer should feel anchored and ready, like a command dock
- Input surface can be taller than a standard chat field
- Primary send/stop action should be visually decisive and easy to hit
- Include a small amount of helper guidance when useful

### Diff Cards

- Diff summary should read like a review artifact, not a generic card
- File rows should be dense, scannable, and tabular in feel
- Added/removed counts need strong numeric readability
- Expanded patch view should feel closer to code review than to note preview

### Approval Cards

- Strong border and warm caution tone
- Tool names and args should use monospace
- Approve / allow session / deny actions need clear hierarchy

### Settings

- Group settings into framed sections with modest spacing rhythm
- Dense enough for power users, but never visually noisy
- Status rows should resemble deployment or runtime health checks

## 5. Layout Principles

- Prefer asymmetry: narrow navigation rail, generous main reading pane
- Use spacing rhythm instead of constant padding everywhere
- Reading and command areas should feel anchored; avoid floating isolated cards
- Keep vertical stacks tight in dense tool surfaces, open in reading surfaces
- Avoid nesting bordered cards inside bordered cards unless state separation is necessary

## 6. Depth & Elevation

- Most surfaces should rely on borders, tone shifts, and subtle gradients rather than obvious drop shadows
- Terminal frame is the main exception and can carry deeper elevation
- Focus states should be crisper than hover states
- Visual hierarchy should come primarily from structure, spacing, and tone contrast

## 7. Do's and Don'ts

### Do

- Extend Obsidian variables instead of replacing them
- Make assistant output feel readable and trustworthy
- Keep developer-tool surfaces compact and precise
- Use monospace where the content is operational, not decorative
- Let diffs and approval steps feel like first-class review objects

### Don't

- Do not style the chat like a consumer messenger
- Do not import bright neon accents or purple-blue AI gradients
- Do not over-card the interface
- Do not make every action a filled primary button
- Do not break light theme in pursuit of terminal aesthetics
- Do not depend on external webfonts for core UI quality

## 8. Responsive Behavior

The plugin runs inside panes, side docks, and smaller split layouts, so responsiveness is pane-driven rather than viewport-driven.

- On narrower widths, collapse chat into a stacked layout
- Sidebar should become top navigation instead of remaining a crushed column
- Preserve composer usability at all widths
- Keep timestamps, delete actions, and status pills legible in compact layouts
- Avoid horizontal scrolling for prose surfaces

## 9. Agent Prompt Guide

When using an AI coding agent on this repository:

- Treat `DESIGN.md` as the source of truth for visual decisions.
- Preserve Obsidian compatibility and theme inheritance.
- Prefer structural, typography, and spacing improvements over decorative effects.
- If redesigning chat surfaces, make assistant output read like a calm markdown workspace.
- If redesigning terminal or diff surfaces, favor precision, density, and clear state hierarchy.

Quick prompt examples:

- "Restyle the chat workspace to match this DESIGN.md. Keep it Obsidian-native and reading-first."
- "Improve the diff review panel using the DESIGN.md rules for artifact density and approval clarity."
- "Refine the settings surface to match the Ante md workspace language without introducing marketing-site patterns."
