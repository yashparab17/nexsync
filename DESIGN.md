# Nexsync design: Swiss structure, terminal/HUD signal, minimal everything else

Branch `ui-redesign-alt`. Swiss design decides layout and hierarchy, a terminal/HUD reading of cybercore decides the accents and
small touches, and minimalism decides what is left out. It is a work tool first: nothing here may cost readability or speed.

## Swiss: layout and hierarchy
- 12-column grid on an 8px unit with a 4px half step: spacing is 4, 8, 12, 16, 24, 32, 48 (no 6 or 10). Page padding and tile gaps are 16px; toolbars, panel headers and column headers are 48px. Everything lines up to the same left edge; text is flush left.
- Hierarchy comes from size, weight and position, not decoration. Four sizes: 13px secondary and readouts (`text-xs`), 15px body
  and titles (`text-sm`), 20px section heads (`text-xl`), 32 to 48px display numbers (`text-4xl`, `text-5xl`; Onest, never mono).
- Opacity is the second hierarchy, from the text colour itself, not extra greys: 100% text, secondary text (`text-muted-foreground`)
  66% or more (as much more as it takes to reach 4.5:1, see `secondaryShare`), tertiary (`text-fg-3`) 45% for metadata only, rules 16% (`--rule`).
- Fills tell panels apart; thin rules (`.frame`, a 1px outline in `--rule`) frame tiles, and single-side lines separate areas.

## Terminal / HUD: the signal layer
- Accent: electric blue with teal as its partner. Themes come only in pairs, one light and one dark, applied together: Default (the original light and dark, first and the first-run theme), Cyber, Catppuccin, Solarized, Gruvbox, GitHub. Custom themes are made per mode.
- Readouts are mono, 13px or smaller: numbers, paths, times, status, shortcuts, tile labels. Display numbers stay in Onest.
- Section index numbers (`01`, `02`…) on tiles and Kanban columns, a `>` prompt in every search box, ASCII logos.
- Corner ticks (`.ticks`) mark hover, focus and selection like a HUD reticle; `.ticks-on` keeps them showing on a hero tile.

## Limits (the effect budget)
- The signal layer (ticks, index numbers, frames) stays out of the Editor, Notes text, forms and tables.
- No scanlines, blinking cursors or typewriter effects.
- No drop shadows, glow, gradients or rounded corners. Buttons are flat.
- Every theme must pass `themeWarnings` (readable text, visible fills); new themes are added to the test automatically.

## Per page
Welcome: the most signal. Dashboard: Swiss bento with indexed tiles and readout labels. Insights: HUD readouts and a ticked hero tile.
Tasks, Kanban, Files, Assets: Swiss lists and grids with almost no effects. Editor, Notes, Settings, dialogs: plain.
