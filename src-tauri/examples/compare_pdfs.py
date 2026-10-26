"""Development only: compares each page of Nexsync's PDF of a document with the PDF Word saved of it, by the words on the page.

    python examples/compare_pdfs.py file.docx word.pdf

Runs `office_pages` with PDF=... for ours and poppler's `pdftotext` (set PDFTOTEXT) for both. A page's score is the share of its words
the two have in common (1.0: the same words); pages below 0.9 are listed. Unlike `compare_pages.py` it does not depend on what a page
opens with, so pages that start with a picture, a code block or the middle of a table are compared like any other.
"""

import collections
import os
import re
import subprocess
import sys
import tempfile


def pages(pdf):
    tool = os.environ.get("PDFTOTEXT", "pdftotext")
    text = subprocess.run([tool, "-layout", pdf, "-"], capture_output=True, text=True, encoding="utf8", errors="replace").stdout
    out = text.split("\f")
    if out and not out[-1].strip():
        out.pop()
    return [collections.Counter(re.findall(r"\w+", p.lower())) for p in out]


def score(a, b):
    both = sum((a & b).values())
    total = max(sum(a.values()), sum(b.values()))
    return 1.0 if total == 0 else both / total


def main():
    docx, word_pdf = sys.argv[1:3]
    ours_pdf = os.path.join(tempfile.mkdtemp(), "ours.pdf")
    env = dict(os.environ, PDF=ours_pdf)
    subprocess.run(["cargo", "run", "--quiet", "--example", "office_pages", "--", docx], env=env, capture_output=True)
    w, o = pages(word_pdf), pages(ours_pdf)
    print(f"Word {len(w)} pages, Nexsync {len(o)} pages")
    bad = 0
    for i in range(max(len(w), len(o))):
        a = w[i] if i < len(w) else collections.Counter()
        b = o[i] if i < len(o) else collections.Counter()
        s = score(a, b)
        if s < 0.9:
            bad += 1
            print(f"page {i + 1}: {s:.2f}  (Word {sum(a.values())} words, Nexsync {sum(b.values())})")
    print(f"{len(w) - bad} of {len(w)} pages have the same words")


main()
