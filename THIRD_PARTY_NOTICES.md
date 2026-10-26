# Third-party notices

Nexsync uses the following open-source projects whose licenses ask that their notice travel with the software. Dependencies fetched from crates.io and npm keep their own license files in their packages; the ones below are named here because their code is used directly.

## WordCraft (wordcraft-doc, wordcraft-docx, wordcraft-formats, wordcraft-docbin, wordcraft-pdf, wordcraft-proof)

Used to read and write .docx, .odt, .rtf, Markdown, HTML and plain-text documents, to read the old .doc format, to write PDF, and to check spelling and grammar (Phase 21). The PDF writer is `craft-pdf` with a patched `krilla` from https://github.com/storytold/craft-libs (pinned at `c3487320b2d1de657b860b3c8abb44e1f2b32bd8`, which WordCraft requires; its own licenses are in that repository). Pinned at commit `611f6fbbbd1cbb35c80fef779e2641fdb3a9f9fc` of our fork https://github.com/yashparab17/wordcraft (branch `nexsync-fidelity`: four small patches on upstream commit `eae242176108d328c5dd81fbc10370c51ab90706` of https://github.com/storytold/wordcraft, to be offered upstream), used under the MIT License (the project is licensed MIT OR Apache-2.0; the fork keeps both license files).

The ArtCraft name, wordmark and logos are trademarks of the ArtCraft Team and are not part of what is used here.

```
MIT License

Copyright (c) 2026 ArtCraft Team and the WordCraft contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## GridCraft (gridcraft-engine, gridcraft-xlsx, gridcraft-chart and the crates they use)

Used to work out spreadsheet formulas, to read and write .xlsx, .xlsb, .xls, .ods and .csv files, to keep cell formats, to draw charts and to write PDF (Phase 21). Pinned at commit `f1894c6da64d4326022ae644c767581816a23c2c` of https://github.com/storytold/gridcraft, used under the MIT License (the project is licensed MIT OR Apache-2.0). The ArtCraft name and logos are not part of what is used.

```
MIT License

Copyright (c) 2026 ArtCraft Team and the GridCraft contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## DeckCraft (deckcraft-model, deckcraft-pptx, deckcraft-render, deckcraft-geom, deckcraft-color)

Used to read and write .pptx decks and to draw slides (Phase 21). Pinned at commit `1dc69720db64323370dda061226becb09ad79fd4` of https://github.com/storytold/deckcraft, used under the MIT License (the project is licensed MIT OR Apache-2.0). The ArtCraft name and logos are not part of what is used.

```
MIT License

Copyright (c) 2026 ArtCraft Team and the DeckCraft contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
