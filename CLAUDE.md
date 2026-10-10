# Design rules

- For any UI work, use the `impeccable` and `taste-*` skills (installed with `npx skills add pbakaus/impeccable` and `npx skills add Leonxlnx/taste-skill`; `.agents/` is gitignored).
- Desktop app: layouts stretch to fill the window, content centred, capped near 88rem.
- Palette: Catppuccin Latte / Mocha. Page background is always the extreme (crust); mantle/base raise from it. Tokens live in `src/index.css`; never hard-code colours, use `success`/`warning`/`info`/`destructive`.
- Type: Plus Jakarta Sans for UI, JetBrains Mono for paths, numbers, keys and section labels. Square corners (radius 0). No text under 13px.
- Buttons are "keycaps" (`--edge` lip); avoid stock shadcn look.
