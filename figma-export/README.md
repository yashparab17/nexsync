# Figma export

Everything needed to look at Nexsync's Welcome and Dashboard pages in Figma, in the new Catppuccin palette and the
original one.

## Files

| File | What it is |
|---|---|
| `welcome-dark.svg`, `welcome-light.svg` | Welcome page, 1440 x 900, sample data |
| `dashboard-dark.svg`, `dashboard-light.svg` | Dashboard page, 1440 x 900, sample data |
| `tokens-studio.json` | Colour tokens for the Tokens Studio plugin: 4 sets, 4 themes |
| `colors.json` | The Catppuccin tokens (hex), plain list |
| `colors-original.json` | The pre-redesign tokens (hex and original oklch) |

## 1. Prepare

1. `git pull origin ui-redesign-v2` (or download the files from GitHub with each file's Raw/Download button).
2. Install the fonts **Onest** and **JetBrains Mono** on your computer. (The original palette used Plus Jakarta Sans.)

## 2. Set up the Figma file

1. In figma.com, create a **Design file** named "Nexsync colours".
2. Make a page called **Pages** and a page called **Tokens**.

## 3. Import the SVGs (page: Pages)

1. Drag the four SVGs onto the canvas together.
2. Rename the frames: `Welcome / Dark`, `Welcome / Light`, `Dashboard / Dark`, `Dashboard / Light`.
3. Arrange them in a grid: dark in one row, light in the row below, Welcome left, Dashboard right.
4. If an SVG comes in as one flat image, right-click it, then **Ungroup**. Or open the SVG in a text editor, copy all of it, and paste onto the canvas.

## 4. Import the tokens (page: Tokens)

1. Open **Plugins**, search for **Tokens Studio for Figma**, and run it.
2. Load `tokens-studio.json` (Settings, then Sync or Import; or paste its contents into the JSON editor).
3. In the **Themes** tab you should see four themes: Catppuccin Latte (light), Catppuccin Mocha (dark), Original (light), Original (dark).
4. Choose **Styles & variables**, then **Create variables** (or **Create styles**), for the themes you want.

## 5. Test colours

- Select a frame, then apply a theme's variables to see the page recolour. The SVG colours are plain fills, not variables,
  so first link them: **Select matching colour** on a fill, then pick the token in the fill picker.
- To compare old against new, duplicate a frame and give the copy the Original theme.

The SVG captures use sample workspace data. Regenerate them after UI changes by running the capture against the dev server.
