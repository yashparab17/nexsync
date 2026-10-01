# Merge study results

Generated 2026-10-01T21:25:32.934Z by `research/merge-study/run.ts`. 7799 merges over 130 files from this repository, 60 attempts per file.

Each merge: two simulated people edit the same file offline (one to three small edits each: rename an identifier, change a number, insert, delete, duplicate or move a line, add a comment, delete a whole block, or wrap lines in a block), every edit leaving the file valid on its own, then exchange Yjs updates. "Broken" means the merged text has syntax errors under the Lezer grammar of its language although both inputs had none.

## Headline

- Merges that diverged between the two devices: **0** of 7799.
- Merges the CRDT completed without complaint but left broken code: **627** of 7799 (**8.0%**).
- Of those, a part of the other person's change could be kept without adding errors in **309** (**49.3%**), after checking 5.7 candidate texts on average.
- On a sample of 975 of the same cases, a three-way textual merge (`git merge-file`) reported a conflict in 340 (34.9%), merged cleanly and validly in 635 (65.1%), and merged cleanly but left broken code in 0 (0.0%).

### The CRDT result against the three-way merge, on the sampled cases

| three-way merge says | cases | CRDT merge valid | CRDT merge broken |
|---|---:|---:|---:|
| conflict | 340 | 270 (79.4%) | 70 (20.6%) |
| clean-valid | 635 | 624 (98.3%) | 11 (1.7%) |
| clean-broken | 0 | 0 (n/a) | 0 (n/a) |

### By language

| | merges | broken by the merge | of those, fixed by keeping part of the change | no fix found |
|---|---:|---:|---:|---:|
| ts | 3120 | 277 (8.9%) | 147 (53.1%) | 130 |
| tsx | 3600 | 256 (7.1%) | 119 (46.5%) | 137 |
| rust | 960 | 87 (9.1%) | 41 (47.1%) | 46 |
| json | 119 | 7 (5.9%) | 2 (28.6%) | 5 |
| css | 0 | 0 (n/a) | 0 (n/a) | 0 |

### By how close the two edits were

| | merges | broken by the merge | of those, fixed by keeping part of the change | no fix found |
|---|---:|---:|---:|---:|
| same line | 703 | 97 (13.8%) | 46 (47.4%) | 51 |
| 1-3 lines apart | 2988 | 368 (12.3%) | 178 (48.4%) | 190 |
| 4-20 lines apart | 2727 | 154 (5.6%) | 82 (53.2%) | 72 |
| more than 20 apart | 1381 | 8 (0.6%) | 3 (37.5%) | 5 |


## Limitations

- The edits are generated, not taken from real developers or real merge commits, so the rates describe this kind of small edit, not collaborative work in general. Replaying real merge commits from public repositories is the obvious next step.
- The corpus is one project's TypeScript, Rust, JSON and CSS.
- "Valid" means the Lezer grammar reports no error node; it says nothing about type errors or behaviour.
- A suggested fix is a text that parses and keeps part of the other person's change. It may not mean what either person intended, which is why the app shows it for approval.
