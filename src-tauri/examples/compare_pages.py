"""Development only: compares where each page starts in Nexsync's layout with a PDF Word saved from the same document.

    python examples/compare_pages.py file.docx file.pdf

It runs `cargo run --example office_pages` (page starts from the layout engine) and poppler's `pdftotext` (set PDFTOTEXT to its path).
Pages are matched by the first letters of their first line; the output lists where the two disagree.
"""

import difflib
import os
import re
import subprocess
import sys


def norm(t):
    t = re.sub(r"^(o|•|▪|-)\s+", "", t)
    return re.sub(r"[^A-Za-z]", "", t)[:10].lower()


def word_pages(pdf):
    tool = os.environ.get("PDFTOTEXT", "pdftotext")
    text = subprocess.run([tool, "-layout", pdf, "-"], capture_output=True, text=True, encoding="utf8", errors="replace").stdout
    out = []
    for page in text.split("\f"):
        if not page.strip():
            continue
        first = next((re.sub(r"\s+", " ", line).strip() for line in page.splitlines() if line.strip() and not re.fullmatch(r"\s*\d+\s*", line)), "")
        out.append(first)
    return out


def our_pages(docx):
    run = subprocess.run(["cargo", "run", "--quiet", "--example", "office_pages", "--", docx], capture_output=True, text=True, encoding="utf8", errors="replace")
    return [line.split("\t", 3)[3].replace("￼", "").strip() for line in run.stdout.splitlines() if line.count("\t") >= 3]


def main():
    docx, pdf = sys.argv[1:3]
    word, ours = word_pages(pdf), our_pages(docx)
    print(f"Word {len(word)} pages, Nexsync {len(ours)} pages")
    a, b = [norm(t) for t in word], [norm(t) for t in ours]
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if tag != "equal":
            print(f"{tag}: Word pages {i1 + 1}-{i2} {word[i1:i2]!r:.90} | Nexsync pages {j1 + 1}-{j2} {ours[j1:j2]!r:.90}")


main()
