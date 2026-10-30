# Bundled fonts

Open fonts whose letters are the same widths as Word's older ones, so that a computer without Word's fonts (a Mac, a Linux machine, a phone) lays a document out with the same lines and pages. They are compiled into the app (`src/commands/workspace/office/fonts.rs`) and added to the layout engine's font list at start-up. Nothing here is a Microsoft font.

| Font | Stands in for | Files | Source | Licence |
|---|---|---|---|---|
| Carlito | Calibri | `Carlito-{Regular,Bold,Italic,BoldItalic}.ttf` | https://github.com/googlefonts/carlito | SIL Open Font License 1.1 (`OFL-Carlito.txt`) |
| Caladea | Cambria | `Caladea-{Regular,Bold,Italic,BoldItalic}.ttf` | https://github.com/huertatipografica/Caladea | SIL Open Font License 1.1 (`OFL-Caladea.txt`) |
| Liberation Sans | Arial | `LiberationSans-{Regular,Bold,Italic,BoldItalic}.ttf` | https://github.com/liberationfonts/liberation-fonts, release 2.1.5 | SIL Open Font License 1.1 (`LICENSE-Liberation.txt`, authors in `AUTHORS-Liberation.txt`) |
| Liberation Serif | Times New Roman | `LiberationSerif-*.ttf` | as above | as above |
| Liberation Mono | Courier New | `LiberationMono-*.ttf` | as above | as above |
| Inter | Aptos, Aptos Display (no open clone exists; Inter is the nearest open face) | `Inter-{Regular,Bold,Italic,BoldItalic}.ttf` | https://github.com/rsms/inter, release 4.0 (`extras/ttf`) | SIL Open Font License 1.1 (`OFL-Inter.txt`) |

The files are the upstream files, unmodified. Inter is added under the names Aptos and Aptos Display only when the computer has no font of those names: Word's own Aptos, when it is there (Word downloads it), is added first and is the one used. Aptos is wider than Calibri and about as wide as Inter, so lines break nearer where Word breaks them than in Carlito. A font the document names that the computer lacks and that has no clone here is laid out in the nearest stand-in the engine knows, and the document's information pane says which.
