# Nexsync design style

Nexsync is a work tool, so the design is quiet, structured and fast to read. Three ideas, in this order of authority:

1. **Swiss structure.** A strict grid, flush-left text, hierarchy from size, weight and position, one accent colour.
2. **Terminal / HUD signal.** Small touches that say "tool for people who write code": mono readouts, index numbers, `>` prompts,
   thin framing rules, an electric blue/teal accent.
3. **Soft edges.** Slightly rounded corners, fills instead of borders, no shadows. The shell is modelled on chat apps (Fluxer,
   Discord): the sidebar and title bar are one piece and the page is a rounded card beside and under them.

If a choice is unclear, pick the quieter one. Nothing may cost readability or speed.

## The shell

- The **title bar** has no app name. It shares the sidebar colour, with the window controls on the right.
- The **navigation sidebar** (`bg-sidebar`) runs from the title bar to the bottom: workspace name with a back arrow (48px), grouped
  links (Write, Storage, Plan; the labels fold away), Members, Insights and Trash at the bottom, then a **user card** (avatar, name,
  role). It resizes by dragging its edge (no hover highlight, the cursor changes). Narrower than 150px it becomes an **icon rail**
  (68px): the icons stay exactly where they are when open, the group labels disappear and thin separators take their place.
- The **page** is a rounded card (`bg-background`, 12px top-left corner) with a 1px light edge (`.window-edge`, drawn on top of page
  content so no page can cover it). The Welcome screen is the same card with no sidebar.
- The **workspace header** (48px) sits at the top of the card: search on the right (with a `>` prompt and `Ctrl K`), then catch-up,
  notifications, the connection chip (a dot and a word: Online, Offline, Connecting, N connected) and workspace settings.
- Below it every page starts with a **toolbar** (48px): title on the left, tabs and filters, search and view switches, and the
  main action on the right.

## Layers and colour

Layers, outermost first, each one step from the next:

| Layer | Token | Used for |
|---|---|---|
| Sidebar and title bar | `bg-sidebar` | navigation |
| Side panel | `bg-panel` (halfway) | Editor tree, Notes list, Kanban columns |
| Page | `bg-background` | everything else |
| Tiles and panels | `bg-muted/40` + `.frame` | Dashboard, Insights, Settings sections |
| Fields | `bg-input` | inputs, selects, search boxes, text areas |

- **One accent** per theme (`--primary`), electric blue/teal in the Cyber theme and teal in Default. Status colours are
  `success`, `warning`, `info` and `destructive`. Never hard-code a colour; use the tokens.
- **Themes come only as light/dark pairs:** Default (first, the first-run theme), Cyber, Catppuccin, Solarized, Gruvbox, GitHub
  (`THEME_FAMILIES` in `src/lib/themes.ts`). Choosing one sets both modes. Each theme is seventeen colours; everything else is
  derived. People can make their own per mode in Settings (a numbered editor with a live preview and an "As CSS" box).
- **Code colours** follow the theme (`--syn-*`), or a chosen or custom scheme (`src/lib/codeSchemes.ts`).
- **Contrast is tested** for every built-in theme (`themeWarnings`): readable text, secondary text at least 4.5:1, and fills that
  differ from the page, since there are no borders to rely on. The theme editor warns about the same things.

## Text

- **Onest** for all UI text and every heading. **JetBrains Mono** only for technical text (paths, numbers, keys, times, tile labels,
  section index numbers) and **never above 13px**. Big numbers are Onest with tabular figures.
- Four sizes: **13px** secondary text and readouts (`text-xs`), **15px** body and titles (`text-sm`), **20px** section heads
  (`text-xl`), **32 to 48px** display numbers (`text-4xl`, `text-5xl`). No text under 13px.
- Hierarchy by opacity of the text colour: 100% text, **secondary** (`text-muted-foreground`) 66% or more, as much more as it takes to
  reach 4.5:1 (`secondaryShare`), **tertiary** (`text-fg-3`) 45% for metadata only, rules 16% (`--rule`).
- **Title Case** for headings, button labels and empty-state titles ("New Task", "No Tasks Yet", "Pick Up Where You Left Off").
  Sentences stay sentence case. Few subtitles: a heading says what it is; a short hint goes on the right, in mono.

## Shape and spacing

- Spacing steps of **4px**: 4, 8, 12, 16, 24, 32, 48. No 6 or 10. Page padding and tile gaps are **16px**.
  Toolbars, panel headers and Kanban column headers are **48px**.
- Corners are **slightly rounded**: `--radius` 8px, controls 6px, tiles and popups 8px, dialogs and the page card 12px.
- **No drop shadows, glow or gradients.** Floating layers (menus, search results, toasts) get a 1px `ring-foreground/10` edge.
- **Borderless.** Boxes are told apart by fill. The rules that stay are single-side separators (`border-b`, `divide-y`), the
  sidebar's, dashed drop zones and status-coloured outlines. Tiles are framed by a 1px rule (`.frame`, 16% of the text colour) that
  turns the accent colour on hover and focus.
- **One focus look** for fields and search boxes: a single 1px accent outline. No glow, no inner box.

## Components

- **Page, PageBody, Panel, Toolbar** (`src/components/layout`): every workspace page is built from these. `Panel` has an optional
  index number (`01`) before the title, a hint on the right and a 48px header.
- **Tiles** (Dashboard): the same header as a panel. Clickable tiles carry an up-right arrow; the number sits below in Onest.
- **Buttons** are flat. Primary is the accent fill, outline is a muted fill, ghost shows a fill on hover. All buttons of a size are
  the same height (small is 32px, default 40px).
- **Tabs, switches, search, selects** in toolbars share the 32px height and the field fill. Dropdown lists take the theme's popup
  colours.
- **Dialogs** have an icon tile and a title; a description only where it warns about losing something. Forms use numbered sections
  (`SectionTitle`) and hairline grids for lists of settings.
- **Empty states** (`EmptyState`) show an illustration, a title, one line and the action.
- **Avatars** are rounded squares; a profile picture stretches to the height of the text beside it so the padding is even.
- **Checkboxes** use the theme (accent fill, soft corners); radios are round.

## Art and glyphs

- Empty states, the Notes and Editor welcome screens, the Dashboard's "Pick Up Where You Left Off" tile and the Welcome screen use
  **unDraw** scenes (`src/assets/art`, drawn inline by `Art`). Every colour in them is a theme token, so they follow all themes: the
  accent for the original purple, neutrals for the rest.
- The **ASCII wordmark** on the Editor welcome screen and the `>` prompts are the terminal touches. No scanlines, blinking cursors,
  dot grids or pixel icons.
- **Icons** are the animated set in `src/components/animate-icons`; they play on hover, and a whole button can drive its icon.

## Motion and keys

- Motion is functional (120 to 200ms) and stops when the system asks for reduced motion.
- **Keyboard first.** `Ctrl K` searches; `F1` lists every shortcut; `Alt+Shift+1…9` jump between pages; in lists `j`/`k` move,
  `Enter` opens, `n` makes a new item, `/` goes to search. Shortcuts are in `src/lib/shortcuts.ts` and must stay clear of the
  Editor's own keys.

## Where things live

| What | Where |
|---|---|
| Tokens, radii, text sizes, frames, window edge | `src/index.css` |
| Themes and contrast checks | `src/lib/themes.ts`, `src/store/ThemeContext.tsx` |
| Code colour schemes | `src/lib/codeSchemes.ts`, `src/lib/editor/codeTheme.ts` |
| Page shell | `src/App.tsx`, `src/components/TitleBar.tsx`, `src/pages/workspace/WorkspaceWrapper.tsx` |
| Sidebar, header, search | `src/components/layout/workspace/` |
| Page, Panel, Toolbar, EmptyState | `src/components/layout/Page.tsx`, `Toolbar.tsx` |
| Illustrations | `src/assets/art`, `src/components/elements/Art.tsx` |
| Shortcuts and list keys | `src/lib/shortcuts.ts`, `src/hooks/useListKeys.ts` |

## Don't

- Don't add borders, shadows, glow or gradients; don't hard-code colours or radii.
- Don't set mono above 13px or any text under 13px; don't use spacing off the 4px steps.
- Don't put effects (frames excepted) on the Editor, Notes text, forms or tables.
- Don't make a theme that is only light or only dark.
