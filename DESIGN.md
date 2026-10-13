# Nexsync design: Swiss structure, terminal/HUD signal, minimal everything else

Branch `ui-redesign-alt`. Swiss design decides layout and hierarchy, a terminal/HUD reading of cybercore decides the accents and
small touches, and minimalism decides what is left out. It is a work tool first: nothing here may cost readability or speed.

## Swiss: layout and hierarchy
- 12-column grid on an 8px unit. Page padding and tile gaps are 12px. Everything lines up to the same left edge; text is flush left.
- Hierarchy comes from size, weight and position, not decoration. Four sizes: 13px secondary and readouts, 15px body and titles,
  20px section heads, 32 to 48px display numbers (in Onest, never mono).
- Opacity is the second hierarchy: text and rules use 100, 60, 40 and 20% of the foreground, not extra greys.
- Fills tell panels apart; thin rules (`.frame`, a 1px outline in `--rule`) frame tiles, and single-side lines separate areas.

## Terminal / HUD: the signal layer
- Accent: electric blue with teal as its partner (Cyber Dark and Cyber Light are the first-run themes; the originals stay).
- Readouts are mono, 13px or smaller: numbers, paths, times, status, shortcuts, tile labels. Display numbers stay in Onest.
- Section index numbers (`01`, `02`…) on tiles, a `>` prompt in search, ASCII logos, a blinking block cursor (`.cursor`) in headings
  of the Welcome page and empty states.
- Corner ticks (`.ticks`) mark hover, focus and selection like a HUD reticle; `.ticks-on` keeps them showing on a hero tile.
- Scanlines (`.scanlines`) sit on the title bar and the Welcome page only.

## Limits (the effect budget)
- Effects live in chrome only: title bar, header, Welcome, empty states, tiles. Never on Editor, Notes, forms or tables.
- Settings → Appearance → Effects turns scanlines and cursors off (`data-effects="off"`); reduced motion stops the blinking.
- No drop shadows, glow, gradients or rounded corners. Buttons are flat.
- Every theme must pass `themeWarnings` (readable text, visible fills); new themes are added to the test automatically.

## Per page
Welcome: the most signal. Dashboard: Swiss bento with indexed tiles and readout labels. Insights: HUD readouts and a ticked hero tile.
Tasks, Kanban, Files, Assets: Swiss lists and grids with almost no effects. Editor, Notes, Settings, dialogs: plain.
