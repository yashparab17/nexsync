# Figma export

`welcome-*.svg` and `dashboard-*.svg` (dark and light) are 1440 x 900 captures of the real pages, with sample workspace data.
Drag them onto a Figma canvas: text, boxes, borders and icons arrive as editable layers.

- Install the **Onest** and **JetBrains Mono** fonts first, or Figma substitutes them.
- `colors.json` holds every colour token for both themes (from `src/index.css`), ready to turn into Figma variables
  (for example with the Variables Import plugin, or the Tokens Studio plugin).
- Colours in the SVGs are plain fills, not variables. Recolour with Figma's "Select matching colour", or rebuild from the tokens.

Regenerate after UI changes by running the capture script against the dev server.

## Tokens Studio

`tokens-studio.json` has four token sets (Catppuccin light and dark, original light and dark) and four themes, in the
format the Tokens Studio for Figma plugin reads. In the plugin: Settings, then Sync / Import, load the file; then use
Styles and variables to create Figma variables or styles from a theme.
