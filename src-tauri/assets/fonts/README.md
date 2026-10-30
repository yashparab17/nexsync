# Bundled fonts

Open fonts whose letters are the same widths as Word's older ones, so that a computer without Word's fonts (a Mac, a Linux machine, a phone) lays a document out with the same lines and pages. They are compiled into the app (`src/commands/workspace/office/fonts.rs`) and added to the layout engine's font list at start-up. Nothing here is a Microsoft font.

| Font | Stands in for | Files | Source | Licence |
|---|---|---|---|---|
| Carlito | Calibri | `Carlito-{Regular,Bold,Italic,BoldItalic}.ttf` | https://github.com/googlefonts/carlito | SIL Open Font License 1.1 (`OFL-Carlito.txt`) |
| Caladea | Cambria | `Caladea-{Regular,Bold,Italic,BoldItalic}.ttf` | https://github.com/huertatipografica/Caladea | SIL Open Font License 1.1 (`OFL-Caladea.txt`) |
| Arimo | Arial | `Arimo-VF.ttf`, `Arimo-Italic-VF.ttf` (variable, weight 400 to 700; Google Fonts' `ofl/arimo`, renamed from `Arimo[wght].ttf`) | https://github.com/google/fonts/tree/main/ofl/arimo, https://github.com/googlefonts/arimo | SIL Open Font License 1.1 (`OFL-Arimo.txt`) |
| Tinos | Times New Roman | `Tinos-{Regular,Bold,Italic,BoldItalic}.ttf` | https://github.com/google/fonts/tree/main/ofl/tinos, https://github.com/googlefonts/tinos | SIL Open Font License 1.1 (`OFL-Tinos.txt`: the licence text of its sibling Cousine with Tinos's copyright line, since Google Fonts ships no licence file in that folder) |
| Cousine | Courier New | `Cousine-{Regular,Bold,Italic,BoldItalic}.ttf` | https://github.com/google/fonts/tree/main/ofl/cousine, https://github.com/googlefonts/cousine | SIL Open Font License 1.1 (`OFL-Cousine.txt`) |
| Intos | Aptos, Aptos Display, Aptos Narrow, Aptos Serif (it is built to have Aptos's letter widths, kerning and line metrics) | `Intos-*.ttf`, `IntosDisplay-*.ttf`, `IntosNarrow-*.ttf`, `IntosSerif-*.ttf`, each Regular, Bold, Italic and Bold Italic | https://github.com/muglug/intos (the built files of `fonts/`; derived from Inter and Gelasio) | SIL Open Font License 1.1 (`OFL-Intos.txt`) |

The files are the upstream files, unmodified apart from the two Arimo files' names. Carlito, Caladea, Arimo and Tinos are added under their own names, which the layout engine already picks for Calibri, Cambria, Arial and Times New Roman. Intos is added under the names Aptos, Aptos Display, Aptos Narrow and Aptos Serif, and Cousine under Courier New (the engine has no open mono font in its list for it), each only when the computer has no font of that name: Word's own Aptos, when it is there (Word downloads it), is added first and is the one used. A font the document names that the computer lacks and that has no clone here is laid out in the nearest stand-in the engine knows, and the document's information pane says which. Aptos Mono has no stand-in of its own.
