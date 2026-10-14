#!/usr/bin/env python3
"""Recolours unDraw illustrations (https://undraw.co, via github.com/balazser/undraw-svg-collection) into theme tokens so they
follow every Nexsync theme: the original primary colour becomes the accent, everything else a neutral from the theme.
Download the scenes by hand from undraw.co (keep their default colour) into a folder named like the files below, then run:
Usage: scripts/recolour-art.py <svgs dir> (reads the NAMES below, writes src/assets/art/<key>.svg)"""
import re, sys, pathlib
NAMES = {
    "tasks": "to-do-list", "kanban": "scrum-board", "files": "folder-files", "assets": "image-folder", "trash": "throw-away",
    "notes": "add-notes", "editor": "code-typing", "recent": "file-searching", "insights": "data-trends",
    "members": "collaboration", "welcome": "connecting-teams", "search": "searching",
}
MAP = {
    "var(--primary-svg-color)": "var(--primary)", "#6c63ff": "var(--primary)",  # the mirror's variable, or unDraw's default colour when downloaded from the site
    "#fff": "var(--card)", "#ffffff": "var(--card)",
    "#f2f2f2": "var(--muted)", "#e6e6e6": "var(--secondary)", "#e4e4e4": "var(--secondary)", "#ccc": "var(--input)", "#cccccc": "var(--input)",
    "#ffb8b8": "var(--fg-3)", "#ffb6b6": "var(--fg-3)", "#feb8b8": "var(--fg-3)",
    "#a0616a": "var(--muted-foreground)", "#9e616a": "var(--muted-foreground)",
    "#2f2e41": "var(--foreground)", "#3f3d56": "var(--muted-foreground)", "#ff6584": "var(--info)",
}
src, out = pathlib.Path(sys.argv[1]), pathlib.Path(__file__).resolve().parent.parent / "src/assets/art"
for key, name in NAMES.items():
    s = (src / f"{name}.svg").read_text()
    s = re.sub(r'<script.*?</script>|\son\w+="[^"]*"', "", s, flags=re.S)
    unknown = set()
    def paint(m):
        v = m.group(2).lower()
        if v in ("none", "currentcolor") or v.startswith("url("): return m.group(0)
        if v not in MAP: unknown.add(v); return m.group(0)
        return f'{m.group(1)}="{MAP[v]}"'
    s = re.sub(r'\b(fill|stroke)="([^"]*)"', paint, s)
    for i in set(re.findall(r'\bid="([^"]+)"', s)):
        s = s.replace(f'id="{i}"', f'id="{key}-{i}"').replace(f"url(#{i})", f"url(#{key}-{i})").replace(f'href="#{i}"', f'href="#{key}-{i}"')
    (out / f"{key}.svg").write_text(s)
    print(key, len(s), "unmapped:", sorted(unknown))
